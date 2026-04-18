import { supabase } from '../supabase.js';

export const Orchestrator = {
    agentId: null,
    isRoutingActive: false,
    isSystemActive: false,
    systemSettings: null,

    async init(agentId, settings) {
        this.agentId = agentId;
        this.systemSettings = settings || {};
        this.isSystemActive = this.systemSettings.is_orchestrator_active || false;
        
        console.log(`[Orquestrador] Iniciado. Agente: ${this.agentId} | Global Ligado: ${this.isSystemActive}`);

        supabase.channel('orchestrator-realtime')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tickets', filter: "status=eq.open" }, async (payload) => {
                console.log(`[Orquestrador] 🚨 NOVO TICKET NA FILA (ID: ${payload.new.id}). Avaliando...`);
                if (this.isRoutingActive && this.isSystemActive) {
                    await this.evaluateAndClaim(payload.new);
                } else {
                    console.log(`[Orquestrador] ❌ Ignorado. Routing Local: ${this.isRoutingActive} | Global: ${this.isSystemActive}`);
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
        const wasActive = this.isSystemActive;
        this.systemSettings = newSettings || {};
        this.isSystemActive = this.systemSettings.is_orchestrator_active === true;
        
        console.log(`[Orquestrador] Settings atualizados. Global Ativo: ${this.isSystemActive}`);
        
        // Se acabou de ligar o global, varre a fila imediatamente
        if (!wasActive && this.isSystemActive && this.isRoutingActive) {
            console.log("[Orquestrador] Global ligado. Buscando casos na fila...");
            this.findAndClaimNext();
        }
    },

    async findAndClaimNext() {
        if (!this.isRoutingActive || !this.isSystemActive) return;

        try {
            console.log("[Orquestrador] 🔍 Buscando o próximo ticket da fila...");
            
            const { data: profile } = await supabase.from('profiles').select('can_web, can_email, status, max_chats, max_emails').eq('id', this.agentId).single();
            if (profile?.status !== 'online') {
                console.log(`[Orquestrador] ❌ Busca abortada: Agente está em status '${profile?.status}'.`);
                return;
            }

            const { data: myTickets } = await supabase.from('tickets')
                .select('id, channel, last_sender')
                .eq('agent_id', this.agentId)
                .eq('status', 'in_progress');

            // Só contabiliza o que está AGUARDANDO o analista
            const myWaitingChats = myTickets.filter(t => t.channel === 'web' && t.last_sender !== 'agent').length;
            const myWaitingEmails = myTickets.filter(t => t.channel === 'email' && t.last_sender !== 'agent').length;

            const maxChats = profile.max_chats !== null ? profile.max_chats : 3;
            const maxEmails = profile.max_emails !== null ? profile.max_emails : 5;

            const canTakeChat = profile?.can_web && (myWaitingChats < maxChats);
            const canTakeEmail = profile?.can_email && (myWaitingEmails < maxEmails);

            if (!canTakeChat && !canTakeEmail) {
                console.log(`[Orquestrador] ❌ Busca abortada: Limites atingidos. Chats(${myWaitingChats}/${maxChats}) Emails(${myWaitingEmails}/${maxEmails})`);
                return; 
            }

            const allowedChannels = [];
            if (canTakeChat) allowedChannels.push('web');
            if (canTakeEmail) allowedChannels.push('email');

            const { data: skills } = await supabase.from('agent_skills').select('subject_id').eq('agent_id', this.agentId);
            const subjectIds = skills.map(s => s.subject_id);
            
            if (subjectIds.length === 0) {
                console.log(`[Orquestrador] ❌ Busca abortada: Agente não possui NENHUMA Skill (Assunto) cadastrada.`);
                return;
            }

            const { data: tickets } = await supabase.from('tickets')
                .select('*')
                .eq('status', 'open')
                .is('agent_id', null)
                .in('subject_id', subjectIds)
                .in('channel', allowedChannels)
                .order('created_at', { ascending: true })
                .limit(1);

            if (tickets && tickets.length > 0) {
                console.log(`[Orquestrador] ✅ Ticket Encontrado! Puxando protocolo HZ-${tickets[0].protocol_number}`);
                await this.evaluateAndClaim(tickets[0]);
            } else {
                console.log(`[Orquestrador] 💤 Nenhum ticket novo compatível com o agente no momento.`);
            }
        } catch (err) {
            console.error("Erro no Orquestrador:", err);
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
            
            const maxChats = profile.max_chats !== null ? profile.max_chats : 3;
            const maxEmails = profile.max_emails !== null ? profile.max_emails : 5;

            if (ticket.channel === 'web' && myWaitingChats >= maxChats) {
                console.log(`[Orquestrador] ❌ Ticket HZ-${ticket.protocol_number} ignorado. Limite de Chat Atingido.`);
                return;
            }
            if (ticket.channel === 'email' && myWaitingEmails >= maxEmails) {
                console.log(`[Orquestrador] ❌ Ticket HZ-${ticket.protocol_number} ignorado. Limite de E-mail Atingido.`);
                return;
            }

            const { data: skills } = await supabase.from('agent_skills').select('subject_id').eq('agent_id', this.agentId);
            const hasSkill = skills.some(s => s.subject_id === ticket.subject_id);
            if (!hasSkill) {
                console.log(`[Orquestrador] ❌ Ticket HZ-${ticket.protocol_number} ignorado. Agente não tem a Skill necessária.`);
                return;
            }

            const { data } = await supabase.from('tickets')
                .update({ agent_id: this.agentId, status: 'in_progress', last_interaction_at: new Date() })
                .eq('id', ticket.id)
                .is('agent_id', null)
                .select();

            if (data && data.length > 0) {
                console.log(`[Orquestrador] 🚀 SUCESSO! Ticket HZ-${ticket.protocol_number} atribuído ao agente.`);
                window.dispatchEvent(new CustomEvent('ticket-assigned', { detail: data[0] }));
                
                // Recursão rápida para puxar mais se houver limite sobrando
                this.findAndClaimNext();
            }
        } catch (err) { console.error("Falha ao avaliar/capturar:", err); }
    }
};