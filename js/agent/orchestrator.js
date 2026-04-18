import { supabase } from '../supabase.js';

export const Orchestrator = {
    agentId: null,
    isRoutingActive: false,
    MAX_CONCURRENT_TICKETS: 10,

    async init(agentId, initialStatus) {
        this.agentId = agentId;
        this.isRoutingActive = initialStatus;

        supabase.channel('orchestrator-realtime')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tickets', filter: "status=eq.open" }, async (payload) => {
                if (this.isRoutingActive) {
                    await this.evaluateAndClaim(payload.new);
                }
            }).subscribe();

        if (this.isRoutingActive) {
            await this.findAndClaimNext();
        }
    },

    setStatus(isActive) {
        this.isRoutingActive = isActive;
        if (isActive) {
            this.findAndClaimNext();
        }
    },

    async findAndClaimNext() {
        if (!this.isRoutingActive) return;

        try {
            // 1. Verifica limite de tickets
            const { count } = await supabase.from('tickets')
                .select('*', { count: 'exact', head: true })
                .eq('agent_id', this.agentId)
                .eq('status', 'in_progress');

            if (count >= this.MAX_CONCURRENT_TICKETS) return;

            // 2. Verifica permissão de canais do Agente
            const { data: profile } = await supabase.from('profiles').select('can_web, can_email').eq('id', this.agentId).single();
            
            const allowedChannels = [];
            if (profile?.can_web) allowedChannels.push('web');
            if (profile?.can_email) allowedChannels.push('email');
            
            if (allowedChannels.length === 0) return; 

            // 3. Verifica Skills (Assuntos)
            const { data: skills } = await supabase.from('agent_skills').select('subject_id').eq('agent_id', this.agentId);
            const subjectIds = skills.map(s => s.subject_id);

            if (subjectIds.length === 0) return;

            // 4. Busca o ticket mais antigo que atenda aos requisitos
            const { data: tickets } = await supabase.from('tickets')
                .select('*')
                .eq('status', 'open')
                .is('agent_id', null)
                .in('subject_id', subjectIds)
                .in('channel', allowedChannels)
                .order('created_at', { ascending: true })
                .limit(1);

            if (tickets && tickets.length > 0) {
                await this.evaluateAndClaim(tickets[0]);
            }
        } catch (err) {
            console.error("Erro na busca recorrente do Orquestrador:", err);
        }
    },

    async evaluateAndClaim(ticket) {
        try {
            const { count } = await supabase.from('tickets')
                .select('*', { count: 'exact', head: true })
                .eq('agent_id', this.agentId)
                .eq('status', 'in_progress');

            if (count >= this.MAX_CONCURRENT_TICKETS) return;

            // TRAVA DE CANAL (Em tempo real)
            const { data: profile } = await supabase.from('profiles').select('can_web, can_email').eq('id', this.agentId).single();
            if (ticket.channel === 'web' && !profile?.can_web) return;
            if (ticket.channel === 'email' && !profile?.can_email) return;

            const { data: skills } = await supabase.from('agent_skills').select('subject_id').eq('agent_id', this.agentId);
            const hasSkill = skills.some(s => s.subject_id === ticket.subject_id);
            
            if (!hasSkill) return;

            // Assumir o Ticket
            const { data, error } = await supabase.from('tickets')
                .update({ agent_id: this.agentId, status: 'in_progress', last_interaction_at: new Date() })
                .eq('id', ticket.id)
                .is('agent_id', null)
                .select();

            if (data && data.length > 0) {
                window.dispatchEvent(new CustomEvent('ticket-assigned', { detail: data[0] }));
            }
        } catch (err) {
            console.error("Erro ao avaliar/capturar ticket no Orquestrador:", err);
        }
    }
};