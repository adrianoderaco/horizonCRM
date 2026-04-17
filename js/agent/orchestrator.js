// Arquivo: js/agent/orchestrator.js
import { supabase } from '../supabase.js';

export const Orchestrator = {
    agentId: null,
    isRoutingActive: false,

    async init(agentId, initialStatus) {
        this.agentId = agentId;
        this.isRoutingActive = initialStatus;
        
        // Fica escutando a chegada de novos tickets abertos 24h por dia
        supabase.channel('orchestrator-channel')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tickets', filter: "status=eq.open" }, async (payload) => {
                if (this.isRoutingActive) {
                    await this.evaluateAndClaim(payload.new);
                }
            }).subscribe();
    },

    setStatus(isActive) {
        this.isRoutingActive = isActive;
    },

    async evaluateAndClaim(ticket) {
        try {
            // 1. O Orquestrador verifica se o analista tem a Skill (Assunto) do ticket
            const { data: skills } = await supabase.from('agent_skills').select('subject_id').eq('agent_id', this.agentId);
            const hasSkill = skills.some(s => s.subject_id === ticket.subject_id);
            
            if (!hasSkill) return; // Se não tem a skill, ignora silenciosamente

            // 2. Tenta "puxar" o ticket (A Regra de Ouro)
            // O ".is('agent_id', null)" garante que se dois analistas tentarem puxar no mesmo milissegundo,
            // o banco de dados só vai entregar para o primeiro, evitando duplicação!
            const { data, error } = await supabase.from('tickets')
                .update({ agent_id: this.agentId, status: 'in_progress' })
                .eq('id', ticket.id)
                .is('agent_id', null)
                .select();

            if (data && data.length > 0) {
                // Sucesso! O ticket foi atribuído a este agente.
                // Dispara um alarme para a tela principal abrir o chat.
                window.dispatchEvent(new CustomEvent('ticket-assigned', { detail: data[0] }));
            }
        } catch (err) {
            console.error("Orquestrador falhou ao avaliar ticket:", err);
        }
    }
};