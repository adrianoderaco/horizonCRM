// Arquivo: js/client/api.js
import { supabase } from '../supabase.js';

export const clientAPI = {
    async getSubjects() {
        const { data, error } = await supabase.from('ticket_subjects').select('*').eq('is_active', true).order('label');
        if (error) throw error;
        return data;
    },

    async getOrCreateCustomer(fullName, email) {
        let { data: customer } = await supabase.from('customers').select('*').eq('email', email).maybeSingle();
        if (!customer) {
            const { data: newCustomer, error } = await supabase.from('customers').insert([{ full_name: fullName, email: email }]).select().single();
            if (error) throw error;
            customer = newCustomer;
        }
        return customer;
    },

    async createTicket(customerId, subjectId, channel, orderNumber) {
        const tag2 = orderNumber ? `Pedido Informado: ${orderNumber}` : null;
        const { data, error } = await supabase.from('tickets').insert([{
            customer_id: customerId,
            subject_id: subjectId,
            channel: channel,
            tag2_detail: tag2
        }]).select().single();

        if (error) throw error;
        return data;
    },

    async sendMessage(ticketId, content) {
        const { error } = await supabase.from('messages').insert([{ ticket_id: ticketId, sender_type: 'customer', content: content }]);
        if (error) throw error;
    },

    subscribeToMessages(ticketId, onNewMessage) {
        return supabase.channel(`ticket-messages-${ticketId}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `ticket_id=eq.${ticketId}` }, payload => {
                if (payload.new.sender_type === 'agent') {
                    onNewMessage(payload.new.content);
                }
            }).subscribe();
    },

    // --- NOVAS FUNÇÕES NPS ---
    subscribeToTicketStatus(ticketId, onStatusChange) {
        return supabase.channel(`ticket-status-${ticketId}`)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tickets', filter: `id=eq.${ticketId}` }, payload => {
                onStatusChange(payload.new.status);
            }).subscribe();
    },

    async submitNPS(ticketId, rating) {
        const { error } = await supabase.from('tickets').update({ rating: rating }).eq('id', ticketId);
        if (error) throw error;
    }
};