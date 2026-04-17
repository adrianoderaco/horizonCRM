// Arquivo: js/agent/api.js
import { supabase } from '../supabase.js';

export const agentAPI = {
    // Faz o login do analista
    async login(email, password) {
        const { data, error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password,
        });
        if (error) throw error;
        return data;
    },

    // Puxa a fila de tickets pendentes (Fazendo os relacionamentos das tabelas)
    async getPendingTickets() {
        const { data, error } = await supabase
            .from('tickets')
            .select(`
                id,
                protocol_number,
                channel,
                created_at,
                customers (full_name, email),
                ticket_subjects (label)
            `)
            .eq('status', 'open')
            .order('created_at', { ascending: false });

        if (error) throw error;
        return data;
    },

    // Escuta novos tickets entrando na fila
    subscribeToQueue(onUpdateCallback) {
        return supabase.channel('agent-queue')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, () => {
                onUpdateCallback();
            }).subscribe();
    }
};