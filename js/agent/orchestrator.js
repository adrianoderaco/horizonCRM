import { supabase } from '../supabase.js';

export const Orchestrator = {
    agentId: null,
    isRoutingActive: false,
    isSystemActive: false,

    async init(agentId, settings) {
        this.agentId = agentId;
        this.isSystemActive = settings?.is_orchestrator_active || false;
        
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

    updateSettings(newSettings) {
        this.isSystemActive = newSettings.is_orchestrator_active || false;
    },

    async findAndClaimNext() {
        if (!this.isRoutingActive || !this.isSystemActive) return;

        try {
            const { data: profile } = await supabase.from('profiles').select('can_web, can_email, status, max_chats, max_emails').eq('id', this.agentId).single();
            if (profile?.status !== 'online') return; 

            // Conta os tickets EM ANDAMENTO
            const { data: myTickets } = await supabase.from('tickets')
                .select('id, channel, last_sender')
                .eq('agent_id', this.agentId)
                .eq('status', 'in_progress');

            // CÁLCULO INTELIGENTE: Só consome o limite se estiver aguardando o Analista (last_sender != 'agent')
            const myWaitingChats = myTickets.filter(t => t.channel === 'web' && t.last_sender !== 'agent').length;
            const myWaitingEmails = myTickets.filter(t => t.channel === 'email' && t.last_sender !== 'agent').length;

            const maxChats = profile.max_chats || 3;
            const maxEmails = profile.max_emails || 5;

            const canTakeChat = profile?.can_web && (myWaitingChats < maxChats);
            const canTakeEmail = profile?.can_email && (myWaitingEmails < maxEmails);

            if (!canTakeChat && !canTakeEmail) return; 

            const allowedChannels = [];
            if (canTakeChat) allowedChannels.push('web');
            if (canTakeEmail) allowedChannels.push('email');

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
            console.error("Erro Orquestrador:", err);
        }
    },

    async evaluateAndClaim(ticket) {
        if (!this.isRoutingActive || !this.isSystemActive) return;
        
        try {
            const { data: profile } = await supabase.from('profiles').select('can_web, can_email, status, max_chats, max_emails').eq('id', this.agentId).single();
            if (profile?.status !== 'online') return;
            if (ticket.channel === 'web' && !profile?.can_web) return;
            if (ticket.channel === 'email' && !profile?.can_email) return;

            const { data: myTickets } = await supabase.from('tickets').select('id, channel, last_sender').eq('agent_id', this.agentId).eq('status', 'in_progress');
            
            const myWaitingChats = myTickets.filter(t => t.channel === 'web' && t.last_sender !== 'agent').length;
            const myWaitingEmails = myTickets.filter(t => t.channel === 'email' && t.last_sender !== 'agent').length;
            
            const maxChats = profile.max_chats || 3;
            const maxEmails = profile.max_emails || 5;

            if (ticket.channel === 'web' && myWaitingChats >= maxChats) return;
            if (ticket.channel === 'email' && myWaitingEmails >= maxEmails) return;

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
        } catch (err) { console.error(err); }
    }
};