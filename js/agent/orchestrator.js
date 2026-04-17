// Arquivo: js/agent/orchestrator.js
import { supabase } from '../supabase.js';

export const Orchestrator = {
    agentId: null,
    isRoutingActive: false,

    async init(agentId, initialStatus) {
        this.agentId = agentId;
        this.isRoutingActive = initialStatus;
        
        console.log("🧠 Orquestrador inicializado. Disponível:", initialStatus);

        // Escuta a tabela de tickets em tempo real
        supabase.channel('orchestrator-realtime')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tickets' }, async (payload) => {
                const newTicket = payload.new;
                
                console.log("📩 Novo ticket detetado no Realtime:", newTicket.protocol_number);

                // Só tenta capturar se o Orquestrador estiver LIGADO e o ticket estiver ABERTO
                if (this.isRoutingActive && newTicket.status === 'open') {
                    await this.evaluateAndClaim(newTicket);
                } else {
                    console.log("⏳ Orquestrador ignorou ticket (Desativado ou Status não é 'open')");
                }
            }).subscribe();
    },

    setStatus(isActive) {
        this.isRoutingActive = isActive;
        console.log("🔄 Status do Orquestrador alterado para:", isActive);
    },

    async evaluateAndClaim(ticket) {
        try {
            // 1. Busca as Skills (Habilidades) que este agente possui
            const { data: skills } = await supabase.from('agent_skills').select('subject_id').eq('agent_id', this.agentId);
            const hasSkill = skills.some(s => s.subject_id === ticket.subject_id);
            
            console.log(`🔍 Avaliando ticket HZ-${ticket.protocol_number}. Agente possui habilidade?`, hasSkill ? "SIM" : "NÃO");

            if (!hasSkill) return;

            // 2. Tenta capturar o ticket para este agente
            // A cláusula .is('agent_id', null) evita que dois agentes capturem o mesmo ticket
            const { data, error } = await supabase.from('tickets')
                .update({ agent_id: this.agentId, status: 'in_progress' })
                .eq('id', ticket.id)
                .is('agent_id', null)
                .select();

            if (data && data.length > 0) {
                console.log("✅ TICKET CAPTURADO COM SUCESSO!");
                // Dispara o evento para o app.js abrir a tela de chat
                window.dispatchEvent(new CustomEvent('ticket-assigned', { detail: data[0] }));
            } else {
                console.log("❌ Falha na captura: Ticket já foi pego por outro agente ou não cumpre os critérios.");
            }
        } catch (err) {
            console.error("💥 Erro crítico no Orquestrador:", err);
        }
    }
};