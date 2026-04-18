// Arquivo: js/agent/api.js
import { supabase } from '../supabase.js';

export const agentAPI = {
    async login(email, password) {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        
        // NOVO: Marca o usuário como ONLINE no banco
        await supabase.from('profiles').update({ is_online: true }).eq('id', data.user.id);
        
        return data;
    },

    async setOffline(userId) {
        // NOVO: Marca como OFFLINE ao deslogar
        await supabase.from('profiles').update({ is_online: false }).eq('id', userId);
    },

    async register(name, email, password) {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.user) {
            const { error: profileError } = await supabase.from('profiles').insert([{ id: data.user.id, full_name: name, email: email, is_approved: false, role: 'analista' }]);
            if (profileError) throw profileError;
        }
        return data;
    },

    async getPendingTickets() {
        const { data, error } = await supabase.from('tickets').select(`id, protocol_number, channel, created_at, status, agent_id, last_sender, last_interaction_at, customers (full_name, email), ticket_subjects (label)`).in('status', ['open', 'in_progress']).order('created_at', { ascending: true });
        if (error) throw error;
        return data;
    },

    async getTicketDetails(ticketId) {
        const { data, error } = await supabase.from('tickets').select(`*, customers (*), ticket_subjects (label)`).eq('id', ticketId).single();
        if (error) throw error;
        return data;
    },

    async closeTicket(ticketId, tag2Text) {
        const { error } = await supabase.from('tickets').update({ status: 'closed', tag2_detail: tag2Text, closed_at: new Date() }).eq('id', ticketId);
        if (error) throw error;
    },

    async transferTicket(ticketId, newSubjectId, newAgentId, tag2Text) {
        const updates = { tag2_detail: tag2Text, status: 'open', last_interaction_at: new Date() };
        if (newAgentId) { updates.agent_id = newAgentId; } else if (newSubjectId) { updates.subject_id = newSubjectId; updates.agent_id = null; }
        const { error } = await supabase.from('tickets').update(updates).eq('id', ticketId);
        if (error) throw error;
    },

    async releaseMyTickets(agentId) {
        const { error } = await supabase.from('tickets').update({ agent_id: null, status: 'open' }).eq('agent_id', agentId).eq('status', 'in_progress');
        if (error) throw error;
    },

    async reassignTicket(ticketId, newAgentId) {
        const updates = newAgentId ? { agent_id: newAgentId, status: 'in_progress', last_interaction_at: new Date() } : { agent_id: null, status: 'open', last_interaction_at: new Date() };
        const { error } = await supabase.from('tickets').update(updates).eq('id', ticketId);
        if (error) throw error;
    },

    async getActiveAgents() {
        // NOVO: Só puxa os analistas que estão APROVADOS e ONLINE
        const { data, error } = await supabase.from('profiles').select('id, full_name').eq('is_approved', true).eq('is_online', true).order('full_name');
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
        await supabase.from('tickets').update({ last_sender: 'agent', last_interaction_at: new Date() }).eq('id', ticketId);
    },

    // NOVO: Busca do Histórico baseada estritamente no E-MAIL do cliente
    async getCustomerHistoryByEmail(email) {
        const { data, error } = await supabase.from('tickets')
            .select(`*, customers!inner(email), ticket_subjects(label)`)
            .eq('customers.email', email)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data;
    },

    async getCustomerOrders(customerId) {
        const { data, error } = await supabase.from('orders').select('*').eq('customer_id', customerId).order('created_at', { ascending: false });
        if (error) throw error;
        return data;
    },

    async createOrder(orderData) {
        const { error } = await supabase.from('orders').insert([orderData]);
        if (error) throw error;
    },

    async getTeamProfiles() {
        const { data, error } = await supabase.from('profiles').select('*, agent_skills(subject_id)').order('created_at', { ascending: true });
        if (error) throw error;
        return data;
    },

    async getAllSubjects() {
        const { data, error } = await supabase.from('ticket_subjects').select('*').eq('is_active', true);
        if (error) throw error;
        return data;
    },

    async approveUser(userId, role) {
        const { error } = await supabase.from('profiles').update({ is_approved: true, role: role }).eq('id', userId);
        if (error) throw error;
    },

    async updateRoutingStatus(userId, isActive) {
        const { error } = await supabase.from('profiles').update({ is_routing_active: isActive }).eq('id', userId);
        if (error) throw error;
    },

    async toggleAgentSkill(agentId, subjectId, isAdding) {
        if (isAdding) {
            const { error } = await supabase.from('agent_skills').insert([{ agent_id: agentId, subject_id: subjectId }]);
            if (error) throw error;
        } else {
            const { error } = await supabase.from('agent_skills').delete().eq('agent_id', agentId).eq('subject_id', subjectId);
            if (error) throw error;
        }
    },

    subscribeToQueue(onUpdateCallback) {
        return supabase.channel('agent-queue').on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, () => onUpdateCallback()).subscribe();
    },

    subscribeToMessages(ticketId, onNewMessage) {
        return supabase.channel(`ticket-${ticketId}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `ticket_id=eq.${ticketId}` }, payload => {
                if (payload.new.sender_type === 'customer') { onNewMessage(payload.new.content); }
            }).subscribe();
    },

    subscribeToAllMessages(ticketId, onNewMessage) {
        return supabase.channel(`monitor-${ticketId}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `ticket_id=eq.${ticketId}` }, payload => {
                // Passa também a data/hora exata (created_at) para a tela
                onNewMessage(payload.new.content, payload.new.sender_type, payload.new.created_at);
            }).subscribe();
    }
};