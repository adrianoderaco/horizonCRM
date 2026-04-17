// Arquivo: js/agent/api.js
import { supabase } from '../supabase.js';

export const agentAPI = {
    // ------------------------------------
    // AUTENTICAÇÃO E PERFIS
    // ------------------------------------
    async login(email, password) {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        return data;
    },

    async register(name, email, password) {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        
        if (data.user) {
            const { error: profileError } = await supabase.from('profiles').insert([{ 
                id: data.user.id, 
                full_name: name, 
                email: email, 
                is_approved: false,
                role: 'analista'
            }]);
            if (profileError) throw profileError;
        }
        return data;
    },

    // ------------------------------------
    // FILA E TICKETS
    // ------------------------------------
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

    async closeTicket(ticketId, tag2Text) {
        const { error } = await supabase
            .from('tickets')
            .update({ status: 'closed', tag2_detail: tag2Text, closed_at: new Date() })
            .eq('id', ticketId);
        if (error) throw error;
    },

    // ------------------------------------
    // CHAT (MENSAGENS)
    // ------------------------------------
    async getMessages(ticketId) {
        const { data, error } = await supabase.from('messages').select('*').eq('ticket_id', ticketId).order('created_at', { ascending: true });
        if (error) throw error;
        return data;
    },

    async sendMessage(ticketId, content) {
        const { error } = await supabase.from('messages').insert([{ ticket_id: ticketId, sender_type: 'agent', content: content }]);
        if (error) throw error;
    },

    // ------------------------------------
    // GESTÃO DE EQUIPE E ORQUESTRADOR
    // ------------------------------------
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

    // Nova função: Liga ou desliga uma Skill (Assunto) para o agente
    async toggleAgentSkill(agentId, subjectId, isAdding) {
        if (isAdding) {
            const { error } = await supabase.from('agent_skills').insert([{ agent_id: agentId, subject_id: subjectId }]);
            if (error) throw error;
        } else {
            const { error } = await supabase.from('agent_skills').delete().eq('agent_id', agentId).eq('subject_id', subjectId);
            if (error) throw error;
        }
    },

    // ------------------------------------
    // INSCRIÇÕES REALTIME (SUPABASE)
    // ------------------------------------
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