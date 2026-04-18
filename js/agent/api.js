import { supabase } from '../supabase.js';

export const agentAPI = {
    async login(email, password) {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await supabase.from('profiles').update({ is_online: true }).eq('id', data.user.id);
        return data;
    },
    async setOffline(userId) { await supabase.from('profiles').update({ is_online: false }).eq('id', userId); },
    async register(name, email, password) {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.user) await supabase.from('profiles').insert([{ id: data.user.id, full_name: name, email: email, is_approved: false, role: 'analista' }]);
        return data;
    },
    async getPendingTickets() {
        const { data, error } = await supabase.from('tickets').select(`id, protocol_number, channel, created_at, status, agent_id, last_sender, last_interaction_at, is_upload_enabled, customers (full_name, email), ticket_subjects (label)`).in('status', ['open', 'in_progress']).order('created_at', { ascending: true });
        if (error) throw error;
        return data;
    },
    async getTicketDetails(ticketId) {
        const { data, error } = await supabase.from('tickets').select(`*, customers (*), ticket_subjects (label)`).eq('id', ticketId).single();
        if (error) throw error;
        return data;
    },
    async closeTicket(ticketId, tag2Text) { await supabase.from('tickets').update({ status: 'closed', tag2_detail: tag2Text, closed_at: new Date(), is_upload_enabled: false }).eq('id', ticketId); },
    async transferTicket(ticketId, newSubjectId, newAgentId, tag2Text) {
        const updates = { tag2_detail: tag2Text, status: 'open', last_interaction_at: new Date(), is_upload_enabled: false };
        if (newAgentId) updates.agent_id = newAgentId; else if (newSubjectId) { updates.subject_id = newSubjectId; updates.agent_id = null; }
        await supabase.from('tickets').update(updates).eq('id', ticketId);
    },
    async releaseMyTickets(agentId) { await supabase.from('tickets').update({ agent_id: null, status: 'open', is_upload_enabled: false }).eq('agent_id', agentId).eq('status', 'in_progress'); },
    async reassignTicket(ticketId, newAgentId) {
        const updates = newAgentId ? { agent_id: newAgentId, status: 'in_progress', last_interaction_at: new Date() } : { agent_id: null, status: 'open', last_interaction_at: new Date() };
        await supabase.from('tickets').update(updates).eq('id', ticketId);
    },
    async getActiveAgents() {
        const { data, error } = await supabase.from('profiles').select('id, full_name, can_web, can_email').eq('is_approved', true).eq('is_online', true).order('full_name');
        if (error) throw error;
        return data;
    },
    async getMessages(ticketId) {
        const { data, error } = await supabase.from('messages').select('*').eq('ticket_id', ticketId).order('created_at', { ascending: true });
        if (error) throw error;
        return data;
    },

    async uploadFile(file) {
        const fileExt = file.name.split('.').pop();
        const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
        const { error } = await supabase.storage.from('attachments').upload(fileName, file);
        if (error) throw error;
        const { data } = supabase.storage.from('attachments').getPublicUrl(fileName);
        return { url: data.publicUrl, name: file.name, type: file.type };
    },
    
    async sendMessage(ticketId, content, fileData = null) {
        const payload = { ticket_id: ticketId, sender_type: 'agent', content: content };
        if (fileData) { payload.file_url = fileData.url; payload.file_name = fileData.name; payload.file_type = fileData.type; }
        await supabase.from('messages').insert([payload]);
        await supabase.from('tickets').update({ last_sender: 'agent', last_interaction_at: new Date() }).eq('id', ticketId);
    },

    async toggleUpload(ticketId, isEnabled) {
        const { error } = await supabase.from('tickets').update({ is_upload_enabled: isEnabled }).eq('id', ticketId);
        if (error) throw error;
    },
    
    // GESTÃO DE CANAIS DO AGENTE
    async toggleChannel(agentId, channel, isEnabled) {
        const col = channel === 'web' ? 'can_web' : 'can_email';
        const { error } = await supabase.from('profiles').update({ [col]: isEnabled }).eq('id', agentId);
        if (error) throw error;
    },

    async getCustomerHistoryByEmail(email) {
        const { data, error } = await supabase.from('tickets').select(`*, customers!inner(email), ticket_subjects(label)`).eq('customers.email', email).order('created_at', { ascending: false });
        if (error) throw error;
        return data;
    },
    async getCustomerOrders(customerId) {
        const { data, error } = await supabase.from('orders').select('*').eq('customer_id', customerId).order('created_at', { ascending: false });
        if (error) throw error;
        return data;
    },
    async createOrder(orderData) { await supabase.from('orders').insert([orderData]); },
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
    async approveUser(userId, role) { await supabase.from('profiles').update({ is_approved: true, role: role }).eq('id', userId); },
    async updateRoutingStatus(userId, isActive) { await supabase.from('profiles').update({ is_routing_active: isActive }).eq('id', userId); },
    async toggleAgentSkill(agentId, subjectId, isAdding) {
        if (isAdding) await supabase.from('agent_skills').insert([{ agent_id: agentId, subject_id: subjectId }]);
        else await supabase.from('agent_skills').delete().eq('agent_id', agentId).eq('subject_id', subjectId);
    },
    subscribeToQueue(onUpdateCallback) { return supabase.channel('agent-queue').on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, () => onUpdateCallback()).subscribe(); },
    subscribeToMessages(ticketId, onNewMessage) {
        return supabase.channel(`ticket-${ticketId}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `ticket_id=eq.${ticketId}` }, payload => {
            if (payload.new.sender_type === 'customer') { onNewMessage(payload.new.content, payload.new.file_url, payload.new.file_name, payload.new.file_type); }
        }).subscribe();
    },
    subscribeToAllMessages(ticketId, onNewMessage) {
        return supabase.channel(`monitor-${ticketId}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `ticket_id=eq.${ticketId}` }, payload => {
            onNewMessage(payload.new.content, payload.new.sender_type, payload.new.created_at, payload.new.file_url, payload.new.file_name, payload.new.file_type);
        }).subscribe();
    }
};