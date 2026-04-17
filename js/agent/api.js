// Arquivo: js/agent/api.js
import { supabase } from '../supabase.js';

export const agentAPI = {
    async login(email, password) {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        return data;
    },

    async getPendingTickets() {
        const { data, error } = await supabase
            .from('tickets')
            .select(`id, protocol_number, channel, created_at, customers (full_name, email), ticket_subjects (label)`)
            .eq('status', 'open')
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data;
    },

    async getTicketDetails(ticketId) {
        const { data, error } = await supabase
            .from('tickets')
            .select(`*, customers (*), ticket_subjects (label)`)
            .eq('id', ticketId)
            .single();
        if (error) throw error;
        return data;
    },

    async getMessages(ticketId) {
        const { data, error } = await supabase.from('messages').select('*').eq('ticket_id', ticketId).order('created_at', { ascending: true });
        if (error) throw error;
        return data;
    },

    async sendMessage(ticketId, content) {
        const { error } = await supabase.from('messages').insert([{ ticket_id: ticketId, sender_type: 'agent', content: content }]);
        if (error) throw error;
    },

    async closeTicket(ticketId, tag2Text) {
        const { error } = await supabase
            .from('tickets')
            .update({ status: 'closed', tag2_detail: tag2Text, closed_at: new Date() })
            .eq('id', ticketId);
        if (error) throw error;
    },

    subscribeToQueue(onUpdateCallback) {
        return supabase.channel('agent-queue').on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, () => onUpdateCallback()).subscribe();
    },

    subscribeToMessages(ticketId, onNewMessage) {
        return supabase.channel(`ticket-${ticketId}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `ticket_id=eq.${ticketId}` }, payload => {
                if (payload.new.sender_type === 'customer') {
                    onNewMessage(payload.new.content);
                }
            }).subscribe();
    }
};