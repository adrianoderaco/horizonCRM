import { supabase } from '../supabase.js';

export const Orchestrator = {
    agentId: null,
    isRoutingActive: false,
    isSystemActive: false,
    MAX_CONCURRENT_TICKETS: 10,

    async init(agentId, systemSettings) {
        this.agentId = agentId;
        this.isSystemActive = systemSettings?.is_orchestrator_active || false;
        
        supabase.channel('orchestrator-realtime')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tickets', filter: "status=eq.open" }, async (payload) => {
                if (this.isRoutingActive && this.isSystemActive) {
                    await this.evaluateAndClaim(payload.new);
                }
            }).subscribe();
    },

    setStatus(isActive) {
        this.isRoutingActive = isActive;
        if (this.isRoutingActive && this.isSystemActive) {
            this.findAndClaimNext();
        }
    },

    setSystemStatus(isActive) {
        this.isSystemActive = isActive;
        if (this.isRoutingActive && this.isSystemActive) {
            this.findAndClaimNext();
        }
    },

    async findAndClaimNext() {
        if (!this.isRoutingActive || !this.isSystemActive) return;

        try {
            const { count } = await supabase.from('tickets')
                .select('*', { count: 'exact', head: true })
                .eq('agent_id', this.agentId)
                .eq('status', 'in_progress');

            if (count >= this.MAX_CONCURRENT_TICKETS) return;

            const { data: profile } = await supabase.from('profiles').select('can_web, can_email, status').eq('id', this.agentId).single();
            if (profile?.status !== 'online') return; 
            
            const allowedChannels = [];
            if (profile?.can_web) allowedChannels.push('web');
            if (profile?.can_email) allowedChannels.push('email');
            
            if (allowedChannels.length === 0) return; 

            const { data: skills } = await supabase.from('agent_skills').select('subject_id').eq('agent_id', this.agentId);
            const subjectIds = skills.map(s => s.subject_id);
            if (subjectIds.length === 0) return;

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
            console.error("Erro na busca de tickets pelo Orquestrador:", err);
        }
    },

    async evaluateAndClaim(ticket) {
        if (!this.isRoutingActive || !this.isSystemActive) return;
        
        try {
            const { count } = await supabase.from('tickets').select('*', { count: 'exact', head: true }).eq('agent_id', this.agentId).eq('status', 'in_progress');
            if (count >= this.MAX_CONCURRENT_TICKETS) return;

            const { data: profile } = await supabase.from('profiles').select('can_web, can_email, status').eq('id', this.agentId).single();
            if (profile?.status !== 'online') return;
            if (ticket.channel === 'web' && !profile?.can_web) return;
            if (ticket.channel === 'email' && !profile?.can_email) return;

            const { data: skills } = await supabase.from('agent_skills').select('subject_id').eq('agent_id', this.agentId);
            const hasSkill = skills.some(s => s.subject_id === ticket.subject_id);
            if (!hasSkill) return;

            const { data } = await supabase.from('tickets')
                .update({ agent_id: this.agentId, status: 'in_progress', last_interaction_at: new Date() })
                .eq('id', ticket.id)
                .is('agent_id', null)
                .select();

            if (data && data.length > 0) {
                window.dispatchEvent(new CustomEvent('ticket-assigned', { detail: data[0] }));
            }
        } catch (err) { console.error("Erro de validação no Orquestrador:", err); }
    }
};