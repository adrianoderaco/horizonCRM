// Arquivo: js/client/api.js
import { supabase } from '../supabase.js';

export const clientAPI = {
    async createTicket(customerId, subjectId) {
        const { data, error } = await supabase.from('tickets')
            .insert([{ customer_id: customerId, subject_id: subjectId, channel: 'web' }])
            .select().single();
        if (error) throw error;
        return data;
    },

    async getMessages(ticketId) {
        const { data, error } = await supabase.from('messages')
            .select('*').eq('ticket_id', ticketId).order('created_at', { ascending: true });
        if (error) throw error;
        return data;
    },

    async sendMessage(ticketId, content) {
        // 1. Salva a mensagem no histórico
        const { error } = await supabase.from('messages')
            .insert([{ ticket_id: ticketId, sender_type: 'customer', content: content }]);
        if (error) throw error;
        
        // 2. AVISA O BANCO QUE O CLIENTE RESPONDEU (Muda bolha para Azul e zera SLA)
        await supabase.from('tickets')
            .update({ last_sender: 'customer', last_interaction_at: new Date() })
            .eq('id', ticketId);
    },

    subscribeToMessages(ticketId, onNewMessage) {
        return supabase.channel(`client-ticket-${ticketId}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `ticket_id=eq.${ticketId}` }, payload => {
                if (payload.new.sender_type === 'agent') {
                    onNewMessage(payload.new.content);
                }
            }).subscribe();
    },

    async submitNPS(ticketId, rating) {
        const { error } = await supabase.from('tickets')
            .update({ rating: rating })
            .eq('id', ticketId);
        if (error) throw error;
    }
};