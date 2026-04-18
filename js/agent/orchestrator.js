// Arquivo: js/agent/orchestrator.js
import { supabase } from '../supabase.js';

export const Orchestrator = {
    agentId: null,
    isRoutingActive: false,
    MAX_CONCURRENT_TICKETS: 10, // Limite máximo de atendimentos simultâneos

    async init(agentId, initialStatus) {
        this.agentId = agentId;
        this.isRoutingActive = initialStatus;
        
        console.log("🧠 Orquestrador Automático Iniciado. Limite:", this.MAX_CONCURRENT_TICKETS);

        // Monitoramento em tempo real
        supabase.channel('orchestrator-realtime')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tickets', filter: "status=eq.open" }, async (payload) => {
                if (this.isRoutingActive) {
                    await this.evaluateAndClaim(payload.new);
                }
            }).subscribe();

        // Busca proativa inicial
        if (this.isRoutingActive) {
            await this.findAndClaimNext();
        }
    },

    setStatus(isActive) {
        this.isRoutingActive = isActive;
        if (isActive) this.findAndClaimNext();
    },

    async findAndClaimNext() {
        if (!this.isRoutingActive) return;

        try {
            // TRAVA 1: Verifica quantos tickets o agente já tem em andamento
            const { count } = await supabase.from('tickets')
                .select('*', { count: 'exact', head: true })
                .eq('agent_id', this.agentId)
                .eq('status', 'in_progress');

            if (count >= this.MAX_CONCURRENT_TICKETS) {
                console.log(`⚠️ Orquestrador pausado: Limite de ${this.MAX_CONCURRENT_TICKETS} tickets atingido.`);
                return; // Aborta a captura
            }

            // Pega as skills do agente
            const { data: skills } = await supabase.from('agent_skills').select('subject_id').eq('agent_id', this.agentId);
            const subjectIds = skills.map(s => s.subject_id);

            if (subjectIds.length === 0) return;

            // Busca o ticket mais antigo
            const { data: tickets } = await supabase.from('tickets')
                .select('*')
                .eq('status', 'open')
                .is('agent_id', null)
                .in('subject_id', subjectIds)
                .order('created_at', { ascending: true })
                .limit(1);

            if (tickets && tickets.length > 0) {
                await this.evaluateAndClaim(tickets[0]);
            }
        } catch (err) {
            console.error("Erro na busca recorrente:", err);
        }
    },

    async evaluateAndClaim(ticket) {
        try {
            // TRAVA 2: Verifica limite antes de capturar um ticket recém-chegado
            const { count } = await supabase.from('tickets')
                .select('*', { count: 'exact', head: true })
                .eq('agent_id', this.agentId)
                .eq('status', 'in_progress');

            if (count >= this.MAX_CONCURRENT_TICKETS) return;

            const { data: skills } = await supabase.from('agent_skills').select('subject_id').eq('agent_id', this.agentId);
            const hasSkill = skills.some(s => s.subject_id === ticket.subject_id);
            
            if (!hasSkill) return;

            // Tenta capturar o ticket
            const { data, error } = await supabase.from('tickets')
                .update({ agent_id: this.agentId, status: 'in_progress', last_interaction_at: new Date() })
                .eq('id', ticket.id)
                .is('agent_id', null)
                .select();

            if (data && data.length > 0) {
                console.log("✅ Ticket capturado automaticamente:", data[0].protocol_number);
                window.dispatchEvent(new CustomEvent('ticket-assigned', { detail: data[0] }));
            }
        } catch (err) {
            console.error("Erro ao capturar ticket:", err);
        }
    }
};