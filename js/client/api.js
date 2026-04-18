import { supabase } from '../supabase.js';

export const clientAPI = {
    async getActiveSubjects() {
        const { data, error } = await supabase.from('ticket_subjects').select('*').eq('is_active', true).order('label');
        if (error) throw error;
        return data;
    },

    async checkCustomer(email) {
        const { data } = await supabase.from('customers').select('*').eq('email', email).single();
        return data;
    },

    async createCustomer(customerData) {
        const { data, error } = await supabase.from('customers').insert([customerData]).select().single();
        if (error) throw error;
        return data;
    },

    async createTicket(customerId, subjectId) {
        const { data, error } = await supabase.from('tickets').insert([{ customer_id: customerId, subject_id: subjectId, channel: 'web' }]).select().single();
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
        const payload = { ticket_id: ticketId, sender_type: 'customer', content: content };
        if (fileData) {
            payload.file_url = fileData.url;
            payload.file_name = fileData.name;
            payload.file_type = fileData.type;
        }
        const { error } = await supabase.from('messages').insert([payload]);
        if (error) throw error;
        
        await supabase.from('tickets').update({ last_sender: 'customer', last_interaction_at: new Date() }).eq('id', ticketId);
    },

    subscribeToTicket(ticketId, onUpdate) {
        return supabase.channel(`client-status-${ticketId}`)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tickets', filter: `id=eq.${ticketId}` }, payload => {
                onUpdate(payload.new);
            }).subscribe();
    },

    subscribeToMessages(ticketId, onNewMessage) {
        return supabase.channel(`client-ticket-${ticketId}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `ticket_id=eq.${ticketId}` }, payload => {
                if (payload.new.sender_type === 'agent') {
                    onNewMessage(payload.new.content, payload.new.file_url, payload.new.file_name, payload.new.file_type);
                }
            }).subscribe();
    },

    async submitNPS(ticketId, rating) {
        const { error } = await supabase.from('tickets').update({ rating: rating }).eq('id', ticketId);
        if (error) throw error;
    }
};