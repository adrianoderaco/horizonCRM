import { supabase } from '../supabase.js';

export const Orchestrator = {
    agentId: null,
    isRoutingActive: false,
    isSystemActive: false,
    systemSettings: null,
    sweepInterval: null, // O novo Radar!

    async init(agentId, settings) {
        this.agentId = agentId;
        this.systemSettings = settings || {};
        this.isSystemActive = this.systemSettings.is_orchestrator_active === true;
        
        console.log(`[Orquestrador] Iniciado. Agente: ${this.agentId} | Global Ligado: ${this.isSystemActive}`);

        // 1. Escuta Tickets Novos (Criados pelo Cliente)
        supabase.channel('orch-insert')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tickets', filter: "status=eq.open" }, async (payload) => {
                if (this.isRoutingActive && this.isSystemActive) {
                    await this.evaluateAndClaim(payload.new);
                }
            }).subscribe();

        // 2. Escuta Tickets Devolvidos para a Fila (Atualizados pelo Gestor)
        supabase.channel('orch-update')
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tickets', filter: "status=eq.open" }, async (payload) => {
                // Se o ticket ficou Open e perdeu o dono, é pra puxar!
                if (this.isRoutingActive && this.isSystemActive && payload.new.agent_id === null) {
                    await this.evaluateAndClaim(payload.new);
                }
            }).subscribe();

        // 3. RADAR AGRESSIVO: Varre a fila a cada 5 segundos para não deixar nada travado
        if (this.sweepInterval) clearInterval(this.sweepInterval);
        this.sweepInterval = setInterval(() => {
            if (this.isRoutingActive && this.isSystemActive) {
                this.findAndClaimNext();
            }
        }, 5000); 
    },

    setStatus(isActive) {
        this.isRoutingActive = isActive;
        if (this.isRoutingActive && this.isSystemActive) {
            this.findAndClaimNext();
        }
    },

    setSystemStatus(isActive) {
        this.isSystemActive = isActive === true;
        if (this.isRoutingActive && this.isSystemActive) {
            this.findAndClaimNext();
        }
    },

    updateSettings(newSettings) {
        const wasActive = this.isSystemActive;
        this.systemSettings = newSettings || {};
        this.isSystemActive = this.systemSettings.is_orchestrator_active === true;
        
        if (!wasActive && this.isSystemActive && this.isRoutingActive) {
            this.findAndClaimNext();
        }
    },

    async findAndClaimNext() {
        if (!this.isRoutingActive || !this.isSystemActive) return;

        try {
            const { data: profile } = await supabase.from('profiles').select('can_web, can_email, status, max_chats, max_emails').eq('id', this.agentId).single();
            if (!profile || profile.status !== 'online') return; 

            // Conta os tickets EM ANDAMENTO deste agente
            const { data: myTickets } = await supabase.from('tickets')
                .select('id, channel, last_sender')
                .eq('agent_id', this.agentId)
                .eq('status', 'in_progress');

            // CÁLCULO DE CAPACIDADE: Conta APENAS os casos aguardando ação do analista
            const myWaitingChats = myTickets.filter(t => t.channel === 'web' && t.last_sender !== 'agent').length;
            const myWaitingEmails = myTickets.filter(t => t.channel === 'email' && t.last_sender !== 'agent').length;

            const maxChats = profile.max_chats !== null ? profile.max_chats : 3;
            const maxEmails = profile.max_emails !== null ? profile.max_emails : 5;

            const canTakeChat = profile.can_web && (myWaitingChats < maxChats);
            const canTakeEmail = profile.can_email && (myWaitingEmails < maxEmails);

            if (!canTakeChat && !canTakeEmail) return; 

            const allowedChannels = [];
            if (canTakeChat) allowedChannels.push('web');
            if (canTakeEmail) allowedChannels.push('email');

            // Pega as SKILLS (Assuntos) do Agente
            const { data: skills } = await supabase.from('agent_skills').select('subject_id').eq('agent_id', this.agentId);
            const subjectIds = skills.map(s => s.subject_id);
            if (subjectIds.length === 0) return;

            // Busca na fila o ticket mais antigo que cruza com as SKILLS e o CANAL
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
            console.error("Erro no Radar do Orquestrador:", err);
        }
    },

    async evaluateAndClaim(ticket) {
        if (!this.isRoutingActive || !this.isSystemActive) return;
        
        try {
            // Trava de segurança no milissegundo: Agente ainda pode pegar?
            const { data: profile } = await supabase.from('profiles').select('can_web, can_email, status, max_chats, max_emails').eq('id', this.agentId).single();
            if (!profile || profile.status !== 'online') return;
            if (ticket.channel === 'web' && !profile.can_web) return;
            if (ticket.channel === 'email' && !profile.can_email) return;

            const { data: myTickets } = await supabase.from('tickets').select('id, channel, last_sender').eq('agent_id', this.agentId).eq('status', 'in_progress');
            
            const myWaitingChats = myTickets.filter(t => t.channel === 'web' && t.last_sender !== 'agent').length;
            const myWaitingEmails = myTickets.filter(t => t.channel === 'email' && t.last_sender !== 'agent').length;
            
            const maxChats = profile.max_chats !== null ? profile.max_chats : 3;
            const maxEmails = profile.max_emails !== null ? profile.max_emails : 5;

            if (ticket.channel === 'web' && myWaitingChats >= maxChats) return;
            if (ticket.channel === 'email' && myWaitingEmails >= maxEmails) return;

            // Agente tem a skill deste ticket exato?
            const { data: skills } = await supabase.from('agent_skills').select('subject_id').eq('agent_id', this.agentId);
            const hasSkill = skills.some(s => s.subject_id === ticket.subject_id);
            if (!hasSkill) return;

            // Se passou em tudo, captura!
            const { data } = await supabase.from('tickets')
                .update({ agent_id: this.agentId, status: 'in_progress', last_interaction_at: new Date() })
                .eq('id', ticket.id)
                .is('agent_id', null) // Impede que 2 agentes peguem ao mesmo tempo
                .select();

            if (data && data.length > 0) {
                console.log(`[Orquestrador] SUCESSO! HZ-${ticket.protocol_number} atribuído.`);
                window.dispatchEvent(new CustomEvent('ticket-assigned', { detail: data[0] }));
                
                // Gatilho rápido: Acabou de pegar um, tenta puxar o próximo pra encher a fila logo!
                this.findAndClaimNext();
            }
        } catch (err) { console.error("Falha ao avaliar/capturar:", err); }
    }
};