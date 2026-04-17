// Arquivo: js/client/api.js
import { supabase } from '../supabase.js';

export const clientAPI = {
    // Busca os Assuntos Ativos (TAG 1)
    async getSubjects() {
        const { data, error } = await supabase.from('ticket_subjects').select('*').eq('is_active', true).order('label');
        if (error) throw error;
        return data;
    },

    // Encontra o cliente ou cria um novo na hora
    async getOrCreateCustomer(fullName, email) {
        // 1. Tenta achar pelo e-mail
        let { data: customer } = await supabase.from('customers').select('*').eq('email', email).maybeSingle();
        
        // 2. Se não existir, cadastra
        if (!customer) {
            const { data: newCustomer, error } = await supabase.from('customers').insert([{ full_name: fullName, email: email }]).select().single();
            if (error) throw error;
            customer = newCustomer;
        }
        return customer;
    },

    // Cria o Ticket e gera o Protocolo
    async createTicket(customerId, subjectId, channel, orderNumber) {
        // Salva o número do pedido na TAG 2 caso ele tenha sido informado
        const tag2 = orderNumber ? `Pedido Informado: ${orderNumber}` : null;
        
        const { data, error } = await supabase.from('tickets').insert([{
            customer_id: customerId,
            subject_id: subjectId,
            channel: channel,
            tag2_detail: tag2
        }]).select().single(); // Retorna os dados, incluindo o protocol_number gerado pelo banco

        if (error) throw error;
        return data;
    },

    // Envia mensagem para o Chat
    async sendMessage(ticketId, content) {
        const { error } = await supabase.from('messages').insert([{ 
            ticket_id: ticketId, 
            sender_type: 'customer', 
            content: content 
        }]);
        if (error) throw error;
    },

    // Escuta respostas do Analista em tempo real
    subscribeToMessages(ticketId, onNewMessage) {
        return supabase.channel(`ticket-${ticketId}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `ticket_id=eq.${ticketId}` }, payload => {
                if (payload.new.sender_type === 'agent') {
                    onNewMessage(payload.new.content);
                }
            }).subscribe();
    }
};