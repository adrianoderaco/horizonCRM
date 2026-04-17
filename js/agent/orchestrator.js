// Arquivo: js/agent/orchestrator.js
import { supabase } from '../supabase.js';

export const Orchestrator = {
    agentId: null,
    isRoutingActive: false,

    async init(agentId, initialStatus) {
        this.agentId = agentId;
        this.isRoutingActive = initialStatus;
        
        console.log("🧠 Orquestrador Automático Iniciado.");

        // 1. Monitoramento em tempo real para novos tickets que entrarem AGORA
        supabase.channel('orchestrator-realtime')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tickets', filter: "status=eq.open" }, async (payload) => {
                if (this.isRoutingActive) {
                    await this.evaluateAndClaim(payload.new);
                }
            }).subscribe();

        // 2. Busca proativa: Verifica se já existem tickets na fila ao iniciar ou mudar status
        if (this.isRoutingActive) {
            await this.findAndClaimNext();
        }
    },

    setStatus(isActive) {
        this.isRoutingActive = isActive;
        if (isActive) this.findAndClaimNext();
    },

    // Busca o ticket mais antigo da fila que combine com as skills do agente
    async findAndClaimNext() {
        if (!this.isRoutingActive) return;

        try {
            // Pega as skills do agente
            const { data: skills } = await supabase.from('agent_skills').select('subject_id').eq('agent_id', this.agentId);
            const subjectIds = skills.map(s => s.subject_id);

            if (subjectIds.length === 0) return;

            // Busca o ticket mais antigo (created_at ascendente) que esteja aberto e sem agente
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
            const { data: skills } = await supabase.from('agent_skills').select('subject_id').eq('agent_id', this.agentId);
            const hasSkill = skills.some(s => s.subject_id === ticket.subject_id);
            
            if (!hasSkill) return;

            // Tenta capturar o ticket
            const { data, error } = await supabase.from('tickets')
                .update({ agent_id: this.agentId, status: 'in_progress' })
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