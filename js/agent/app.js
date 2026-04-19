import { agentAPI } from './api.js';
import { supabase } from '../supabase.js';
import { Orchestrator } from './orchestrator.js';
import { Sidebar } from './sidebar.js';
import { Translator } from './i18n.js';
import { Dashboard } from './dashboard.js';

const App = {
    activeTicketId: null,
    messageSub: null,
    monitorSub: null,
    internalChatTarget: null,
    isRegisterMode: false,
    currentUser: null,
    currentCustomer: null,
    currentTicket: null,
    allSubjects: [],
    allSubsubjects: [],
    activeAgents: [],
    timerInterval: null,
    activeTickets: [],
    systemSettings: null,
    closingTickets: new Set(),
    
    dashboardTickets: [],
    allProfiles: [],
    allTeamProfiles: [],
    allTeamLogs: [],
    dashFilterAgent: null,
    teamSearchQuery: "",
    tableSearchQuery: "",

    // Preferência de Áudio
    isSoundEnabled: true,

    async init() {
        window.agentApp = this; 
        Dashboard.init(this);
        
        try {
            this.systemSettings = await agentAPI.getSystemSettings();
        } catch (e) {
            console.warn("Aviso: Configurações ausentes. Usando locais.");
            this.systemSettings = { is_orchestrator_active: false, chat_timeout_min: 10, email_timeout_hr: 24, chat_warning_min: 8, email_warning_hr: 20 };
        }

        // Restaura a preferência de Som
        const savedSound = localStorage.getItem('horizon_sound');
        if (savedSound !== null) this.isSoundEnabled = savedSound === 'true';
        const iconSound = document.getElementById('icon-sound');
        if (iconSound) iconSound.innerText = this.isSoundEnabled ? 'volume_up' : 'volume_off';

        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        if(document.getElementById('dash-start')) document.getElementById('dash-start').value = firstDay.toISOString().split('T')[0];
        if(document.getElementById('dash-end')) document.getElementById('dash-end').value = today.toISOString().split('T')[0];

        this.startLiveTimers(); 

        window.addEventListener('ticket-assigned', async (e) => { 
            agentApp.playAlert('ticket');
            await agentApp.loadQueue(); 
            if (!agentApp.activeTicketId) agentApp.pickTicket(e.detail.id); 
        });

        document.getElementById('login-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('btn-login'); 
            const orig = btn.innerHTML;
            btn.innerHTML = `<span class="material-symbols-outlined animate-spin">refresh</span> Processando...`;
            
            const email = document.getElementById('login-email').value; 
            const pass = document.getElementById('login-pass').value;

            if (agentApp.isRegisterMode) {
                try { 
                    await agentAPI.register(document.getElementById('reg-name').value, email, pass); 
                    alert("Aguarde aprovação pelo Gestor."); agentApp.toggleAuthMode(); 
                } catch (err) { alert("Erro ao registrar: " + err.message); } finally { btn.innerHTML = orig; }
                return;
            }

            try {
                const authData = await agentAPI.login(email, pass);
                const { data: profile } = await supabase.from('profiles').select('*').eq('id', authData.user.id).single();
                
                if (!profile || !profile.is_approved) { alert("Acesso pendente de aprovação."); await supabase.auth.signOut(); btn.innerHTML = orig; return; }
                
                agentApp.currentUser = profile; 
                document.getElementById('view-login').classList.add('hidden-view'); 
                document.getElementById('view-app').classList.remove('hidden-view');
                
                agentApp.allSubjects = await agentAPI.getAllSubjects(); 
                agentApp.allSubsubjects = await agentAPI.getAllSubsubjects();
                agentApp.activeAgents = await agentAPI.getActiveAgents();
                
                Sidebar.render('sidebar-root', profile.role);
                agentApp.applyWatermark(profile.full_name);

                if (profile.role === 'gestor') { 
                    document.getElementById('wrapper-routing').classList.remove('hidden-view'); 
                    document.getElementById('btn-settings').classList.remove('hidden-view'); 
                    if (document.getElementById('toggle-routing')) document.getElementById('toggle-routing').checked = agentApp.systemSettings.is_orchestrator_active === true;
                    await Dashboard.render(); 
                }
                
                if(document.getElementById('agent-status-select')) document.getElementById('agent-status-select').value = profile.status || 'online';

                Orchestrator.init(profile.id, agentApp.systemSettings);
                Orchestrator.setStatus(profile.status === 'online');
                await agentApp.loadQueue();

                agentAPI.subscribeToQueue(async () => {
                    await agentApp.loadQueue();
                    if (agentApp.currentUser && agentApp.currentUser.status === 'online') Orchestrator.findAndClaimNext();
                });

                agentAPI.subscribeToSettings((newCfg) => {
                    agentApp.systemSettings = newCfg;
                    Orchestrator.updateSettings(newCfg);
                    if (profile.role === 'gestor' && document.getElementById('toggle-routing')) document.getElementById('toggle-routing').checked = newCfg.is_orchestrator_active === true;
                });

                agentAPI.subscribeToProfiles(async () => { 
                    if (!document.getElementById('sec-team').classList.contains('hidden-view')) await agentApp.loadTeam(); 
                });

                agentAPI.subscribeToMyProfile(agentApp.currentUser.id, async (newProfile) => {
                    if (newProfile.status !== agentApp.currentUser.status) {
                        agentApp.currentUser.status = newProfile.status;
                        if(document.getElementById('agent-status-select')) document.getElementById('agent-status-select').value = newProfile.status;
                        if (newProfile.status !== 'online') {
                            Orchestrator.setStatus(false);
                            agentApp.activeTicketId = null; document.getElementById('menu-chat').classList.add('hidden-view');
                            agentApp.navigate('queue'); alert("Atenção: Seu status foi alterado.");
                        } else { Orchestrator.setStatus(true); }
                        await agentApp.loadQueue();
                    }
                });

                agentAPI.subscribeToInternalMessages(agentApp.currentUser.id, async (msg) => {
                    if (document.getElementById('modal-internal-chat').classList.contains('hidden-view') || agentApp.internalChatTarget !== msg.sender_id) {
                        agentApp.playAlert('message'); // Toca o som para nova msg interna
                        const alertBtn = document.getElementById('btn-internal-alert');
                        if (alertBtn) {
                            alertBtn.classList.remove('hidden-view');
                            try {
                                const { data: sender } = await supabase.from('profiles').select('full_name').eq('id', msg.sender_id).single();
                                alertBtn.dataset.senderId = msg.sender_id; alertBtn.dataset.senderName = sender?.full_name || 'Equipe';
                            } catch(e) { console.error(e); }
                        }
                    } else { agentApp.renderInternalMsg(msg, false); }
                });

            } catch (error) { alert(`Erro ao tentar entrar no sistema:\n\n${error.message}`); btn.innerHTML = orig; }
        });

        document.getElementById('agent-chat-form')?.addEventListener('submit', async (e) => {
            e.preventDefault(); const input = document.getElementById('chat-input'); const text = input.value.trim();
            if(!text || !agentApp.activeTicketId) return;
            agentApp.renderMsg(text, 'agent'); input.value = '';
            try { await agentAPI.sendMessage(agentApp.activeTicketId, text); agentApp.updateLocalBubble(); Orchestrator.findAndClaimNext(); } catch(err) { alert("Erro ao enviar."); }
        });

        document.getElementById('agent-email-form')?.addEventListener('submit', async (e) => {
            e.preventDefault(); const input = document.getElementById('email-input'); const text = input.value.trim();
            if(!text || !agentApp.activeTicketId) return;
            if(!confirm("Prosseguir com a resposta ao cliente? O ticket sairá da sua tela.")) return;
            const btn = document.getElementById('btn-send-email'); const origHTML = btn.innerHTML;
            btn.innerHTML = `<span class="material-symbols-outlined animate-spin text-[18px]">refresh</span> Enviando...`; btn.disabled = true;
            try {
                await agentAPI.sendMessage(agentApp.activeTicketId, text); input.value = ''; 
                await agentAPI.closeTicket(agentApp.activeTicketId, 'E-mail respondido', '', 'Aguardando cliente');
                agentApp.activeTickets = agentApp.activeTickets.filter(t => t.id !== agentApp.activeTicketId);
                agentApp.activeTicketId = null; document.getElementById('menu-chat').classList.add('hidden-view');
                agentApp.navigate('queue'); await agentApp.loadQueue(); Orchestrator.findAndClaimNext();
            } catch(err) { alert("Erro ao responder o e-mail."); } finally { btn.innerHTML = origHTML; btn.disabled = false; }
        });

        agentApp.setupAgentAttachment('btn-agent-attach', 'agent-file-input'); 
        agentApp.setupAgentAttachment('btn-email-attach', 'email-file-input', true);
        
        document.getElementById('internal-chat-form')?.addEventListener('submit', async (e) => {
            e.preventDefault(); const input = document.getElementById('internal-chat-input'); const text = input.value.trim();
            if (!text || !agentApp.internalChatTarget) return;
            try { await agentAPI.sendInternalMessage(agentApp.currentUser.id, agentApp.internalChatTarget, text); agentApp.renderInternalMsg({ content: text }, true); input.value = ''; } catch (err) { alert("Erro ao enviar."); }
        });
    },

    // ===============================================
    // LÓGICA DE SOM
    // ===============================================
    toggleSound() {
        this.isSoundEnabled = !this.isSoundEnabled;
        localStorage.setItem('horizon_sound', this.isSoundEnabled);
        const icon = document.getElementById('icon-sound');
        if (icon) icon.innerText = this.isSoundEnabled ? 'volume_up' : 'volume_off';
    },

    playAlert(type) {
        if (!this.isSoundEnabled) return;
        try {
            const url = type === 'ticket' 
                ? 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3' 
                : 'https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3'; 
            const audio = new Audio(url);
            audio.play();
        } catch(e) { console.error("Erro ao tocar áudio", e); }
    },

    // ===============================================
    // DELEGAÇÕES
    // ===============================================
    async renderDashboard() { await Dashboard.render(); },
    filterDashboardByAgent(id, name) { Dashboard.filterDashboardByAgent(id, name); },
    filterTable() { agentApp.tableSearchQuery = document.getElementById('table-search')?.value.toLowerCase() || ""; Dashboard.renderClosedCasesTable(agentApp.dashboardTickets, agentApp.allProfiles); },
    exportCSV() { Dashboard.exportCSV(); },
    async changeLanguage(lang) { Translator.setLanguage(lang); if (agentApp.activeTicketId) await agentApp.pickTicket(agentApp.activeTicketId); },

    // ===============================================
    // TIMERS, SLA E BOLHAS VISUAIS
    // ===============================================
    startLiveTimers() {
        if (agentApp.timerInterval) clearInterval(agentApp.timerInterval);
        
        agentApp.timerInterval = setInterval(() => {
            document.querySelectorAll('.live-timer').forEach(el => {
                const diffSeconds = Math.max(0, Math.floor((Date.now() - new Date(el.dataset.time).getTime()) / 1000));
                const h = String(Math.floor(diffSeconds / 3600)).padStart(2, '0'); const m = String(Math.floor((diffSeconds % 3600) / 60)).padStart(2, '0'); const s = String(diffSeconds % 60).padStart(2, '0');
                el.innerText = `${h}:${m}:${s}`;
                if (diffSeconds > 600) { el.classList.remove('text-slate-600'); el.classList.add('text-red-600'); }
            });

            if (agentApp.systemSettings && agentApp.currentUser) {
                const chatWarnSecs = (agentApp.systemSettings.chat_warning_min || 8) * 60;
                const emailWarnSecs = (agentApp.systemSettings.email_warning_hr || 24) * 3600;
                const chatCloseSecs = (agentApp.systemSettings.chat_timeout_min || 10) * 60;
                const emailCloseSecs = (agentApp.systemSettings.email_timeout_hr || 48) * 3600;
                
                const totalChatCloseSecs = chatWarnSecs + chatCloseSecs;
                const totalEmailCloseSecs = emailWarnSecs + emailCloseSecs;

                agentApp.activeTickets.forEach(t => {
                    if (t.agent_id !== agentApp.currentUser.id) return;
                    
                    const lastTime = new Date(t.last_interaction_at || t.created_at).getTime();
                    const diffSeconds = Math.floor((Date.now() - lastTime) / 1000);
                    
                    const el = document.getElementById(`bubble-${t.id}`);
                    if (el) {
                        if (t.last_sender === 'customer') {
                            el.classList.add('animate-pulse');
                            if (!t.first_reply_at) {
                                el.style.backgroundColor = '#16a34a'; // Verde (Novo)
                                el.style.color = '#ffffff';
                            } else {
                                el.style.backgroundColor = '#2563eb'; // Azul (Retornou)
                                el.style.color = '#ffffff';
                            }
                        } else {
                            el.classList.remove('animate-pulse');
                            const diffMinutes = Math.floor(diffSeconds / 60); 
                            const maxFadingMins = t.channel === 'web' ? (agentApp.systemSettings.chat_timeout_min || 10) : 60; 
                            const opacity = Math.max(0.15, 1 - (diffMinutes / maxFadingMins));
                            el.style.backgroundColor = `rgba(51, 65, 85, ${opacity})`; // Cinza esmaecendo
                            el.style.color = opacity < 0.4 ? '#0f172a' : '#ffffff';
                        }
                    }

                    if (t.last_sender === 'agent' && !agentApp.closingTickets.has(t.id)) {
                        if (!t.has_warning_sent) {
                            const isWebWarn = t.channel === 'web' && diffSeconds >= chatWarnSecs;
                            const isEmailWarn = t.channel === 'email' && diffSeconds >= emailWarnSecs;
                            if (isWebWarn || isEmailWarn) {
                                t.has_warning_sent = true; 
                                agentApp.executeWarning(t);
                            }
                        } else {
                            const isWebClose = t.channel === 'web' && diffSeconds >= totalChatCloseSecs;
                            const isEmailClose = t.channel === 'email' && diffSeconds >= totalEmailCloseSecs;
                            if (isWebClose || isEmailClose) {
                                agentApp.closingTickets.add(t.id);
                                agentApp.executeAutoClose(t);
                            }
                        }
                    }
                });
            }
        }, 1000);
    },

    async executeWarning(ticket) {
        try {
            console.log(`[SLA] Disparando Alerta de Ociosidade (HZ-${ticket.protocol_number})`);
            let rawMsg = ticket.channel === 'web' ? agentApp.systemSettings.warning_macro_chat : agentApp.systemSettings.warning_macro_email;
            let msg = rawMsg || "Atenção: O atendimento será encerrado em breve por inatividade. Ainda está por aí?";
            msg = msg.replace(/\[nome do cliente\]/gi, ticket.customers?.full_name || 'Cliente');
            msg = msg.replace(/\[protocolo\]/gi, ticket.protocol_number);

            await agentAPI.sendSystemMessage(ticket.id, msg, 'sla');
            if (agentApp.activeTicketId === ticket.id) agentApp.renderMsg(msg, 'system');
        } catch(e) { console.error("Falha ao enviar alerta:", e); }
    },

    async executeAutoClose(ticket) {
        try {
            console.log(`[SLA] Encerrando HZ-${ticket.protocol_number} por inatividade.`);
            let rawMsg = agentApp.systemSettings.closure_macro;
            let msg = rawMsg || "Atendimento encerrado por inatividade.";
            msg = msg.replace(/\[nome do cliente\]/gi, ticket.customers?.full_name || 'Cliente');
            msg = msg.replace(/\[protocolo\]/gi, ticket.protocol_number);

            await agentAPI.sendSystemMessage(ticket.id, msg, null);
            await agentAPI.closeTicket(ticket.id, 'Outros', 'Abandono', 'Encerrado pelo sistema (Falta de interação do cliente).');
            
            agentApp.activeTickets = agentApp.activeTickets.filter(t => t.id !== ticket.id);
            if (agentApp.activeTicketId === ticket.id) {
                agentApp.activeTicketId = null; document.getElementById('menu-chat').classList.add('hidden-view'); agentApp.navigate('queue');
            }
            await agentApp.loadQueue();
        } catch(e) { console.error("Falha na macro de encerramento:", e); } finally { agentApp.closingTickets.delete(ticket.id); }
    },

    // ===============================================
    // CORE GERAL
    // ===============================================
    async toggleGlobalOrchestrator(isActive) {
        try { await agentAPI.updateSystemSettings({ is_orchestrator_active: isActive }); } catch (e) { document.getElementById('toggle-routing').checked = !isActive; alert("Erro de Conexão."); }
    },

    setupAgentAttachment(btnId, inputId, isEmail = false) {
        const btn = document.getElementById(btnId); const input = document.getElementById(inputId);
        if (btn && input) {
            btn.addEventListener('click', () => input.click());
            input.addEventListener('change', async (e) => {
                const file = e.target.files[0]; if(!file || !agentApp.activeTicketId) return;
                const sendBtnId = isEmail ? 'btn-send-email' : 'btn-send-chat';
                const btnSend = document.getElementById(sendBtnId); const origText = btnSend.innerHTML;
                btnSend.innerHTML = `<span class="material-symbols-outlined animate-spin">refresh</span>`; btnSend.disabled = true;
                try {
                    const fileData = await agentAPI.uploadFile(file);
                    await agentAPI.sendMessage(agentApp.activeTicketId, "📎 Anexo enviado pelo Analista:", fileData);
                    agentApp.updateLocalBubble();
                    if (isEmail) { const msgs = await agentAPI.getMessages(agentApp.activeTicketId); agentApp.renderEmailThread(agentApp.currentTicket, msgs); } else { agentApp.renderMsg("📎 Anexo enviado:", 'agent', fileData.url, fileData.name, fileData.type); }
                } catch(err) { alert("Erro no upload."); } finally { btnSend.innerHTML = origText; btnSend.disabled = false; e.target.value = ''; }
            });
        }
    },

    updateLocalBubble() {
        const tkIndex = agentApp.activeTickets.findIndex(t => t.id === agentApp.activeTicketId);
        if (tkIndex > -1) { agentApp.activeTickets[tkIndex].last_sender = 'agent'; agentApp.activeTickets[tkIndex].last_interaction_at = new Date().toISOString(); agentApp.renderBubbles(); }
    },

    async updateMyStatus(newStatus) {
        if (!agentApp.currentUser) return;
        try {
            await agentAPI.changeStatus(agentApp.currentUser.id, newStatus);
            agentApp.currentUser.status = newStatus;
            if (newStatus !== 'online') {
                await agentAPI.releaseMyTickets(agentApp.currentUser.id);
                Orchestrator.setStatus(false);
                alert(`Status alterado para ${newStatus.toUpperCase()}. Seus atendimentos retornaram para a fila.`);
                agentApp.activeTicketId = null; document.getElementById('menu-chat').classList.add('hidden-view');
                agentApp.navigate('queue'); await agentApp.loadQueue();
            } else { Orchestrator.setStatus(true); await agentApp.loadQueue(); }
        } catch (e) { alert("Erro ao mudar o status."); }
    },

    async forceAgentStatus(agentId, newStatus) {
        if(!confirm(`Deseja forçar o status para ${newStatus.toUpperCase()}? Os tickets em andamento serão devolvidos à fila.`)) return;
        try { await agentAPI.changeStatus(agentId, newStatus); if (newStatus !== 'online') await agentAPI.releaseMyTickets(agentId); await agentApp.loadTeam(); } catch(e) { alert("Erro ao alterar status."); }
    },

    async updateAgentLimits(agentId, maxChats, maxEmails) {
        try { let c = maxChats === "" ? null : maxChats; let e = maxEmails === "" ? null : maxEmails; await agentAPI.updateAgentLimits(agentId, c, e); } catch (e) { alert("Erro ao atualizar limites."); }
    },
    
    async updateAgentGroup(agentId, groupName) {
        try { await agentAPI.updateAgentGroup(agentId, groupName); } catch (e) { alert("Erro ao atualizar equipe."); }
    },

    applyWatermark(name) {
        const wm = document.createElement('div'); wm.className = 'fixed inset-0 pointer-events-none flex flex-wrap overflow-hidden justify-center items-center select-none'; wm.style.zIndex = '99999'; 
        let spans = ''; for(let i=0; i<150; i++) spans += `<span class="transform -rotate-45 text-2xl font-black text-slate-900 m-8 opacity-[0.03]">${name}</span>`;
        wm.innerHTML = spans; document.body.appendChild(wm);
    },

    renderBubbles() {
        const container = document.getElementById('bubble-container'); if(!container) return;
        const myTickets = agentApp.activeTickets.filter(t => t.status === 'in_progress' && t.agent_id === agentApp.currentUser.id).sort((a, b) => new Date(a.last_interaction_at || a.created_at).getTime() - new Date(b.last_interaction_at || b.created_at).getTime());
        container.innerHTML = myTickets.map(t => {
            const initial = t.customers?.full_name ? t.customers.full_name.charAt(0).toUpperCase() : 'C';
            return `<div id="bubble-${t.id}" onclick="agentApp.pickTicket('${t.id}')" class="chat-bubble cursor-pointer text-lg font-black w-10 h-10 rounded-full flex items-center justify-center shadow-md transition-all hover:scale-110 shrink-0 border-2 ${agentApp.activeTicketId === t.id ? 'border-slate-800' : 'border-transparent'}" data-sender="${t.last_sender || 'customer'}" data-time="${t.last_interaction_at || t.created_at}" title="${t.customers?.full_name || 'Cliente'} (HZ-${t.protocol_number})">${initial}</div>`
        }).join('');
    },

    toggleAuthMode() {
        agentApp.isRegisterMode = !agentApp.isRegisterMode;
        document.getElementById('auth-title').innerText = agentApp.isRegisterMode ? "Solicitar Acesso" : "Acesso Restrito";
        document.getElementById('btn-login').innerHTML = agentApp.isRegisterMode ? 'Criar Conta' : 'Entrar <span class="material-symbols-outlined">login</span>';
        const regName = document.getElementById('reg-name');
        if (agentApp.isRegisterMode) { regName.classList.remove('hidden-view'); regName.required = true; } else { regName.classList.add('hidden-view'); regName.required = false; }
    },

    navigate(target) {
        ['queue', 'chat', 'team', 'dashboard', 'settings'].forEach(s => { const el = document.getElementById(`sec-${s}`); if(el) el.classList.add('hidden-view'); });
        document.getElementById(`sec-${target}`).classList.remove('hidden-view');
        if (target === 'team') agentApp.loadTeam(); if (target === 'dashboard') agentApp.renderDashboard(); if (target === 'settings') agentApp.loadSettingsUI();
    },

    async loadQueue() {
        try {
            agentApp.activeTickets = await agentAPI.getPendingTickets();
            const isGestor = agentApp.currentUser.role === 'gestor';
            const gestorView = document.getElementById('queue-gestor-view'); const agentView = document.getElementById('queue-agent-view');
            const countEl = document.getElementById('queue-count'); const tbody = document.getElementById('queue-tbody');

            agentApp.renderBubbles();

            if (isGestor) {
                gestorView.classList.remove('hidden-view'); agentView.classList.add('hidden-view');
                const tickets = agentApp.activeTickets;
                if(countEl) countEl.innerText = `${tickets.length} tickets ativos`;
                if (tickets.length === 0) { tbody.innerHTML = `<tr><td colspan="4" class="p-10 text-center text-slate-300 font-bold">Nenhum ticket na fila.</td></tr>`; return; }

                tbody.innerHTML = tickets.map(t => {
                    const inProg = t.status === 'in_progress'; const isMine = t.agent_id === agentApp.currentUser.id;
                    const agentName = t.agent_id ? (agentApp.activeAgents.find(a => a.id === t.agent_id)?.full_name || 'Desconhecido') : 'Na Fila (Aguardando)';
                    let statusHtml = `<div class="flex flex-col gap-1 items-start">${inProg ? `<span class="bg-amber-100 text-amber-700 text-[10px] px-2 py-0.5 rounded font-bold">Em Atendimento</span>` : `<span class="bg-blue-100 text-blue-700 text-[10px] px-2 py-0.5 rounded font-bold">Aguardando Fila</span>`}<span class="live-timer text-xs font-black font-mono text-slate-600" data-time="${t.created_at}">--:--:--</span></div>`;
                    let chBadge = t.channel === 'email' ? `<span class="text-[10px] bg-orange-100 text-orange-700 border border-orange-200 px-2 py-0.5 rounded ml-2 font-bold flex items-center w-max gap-1"><span class="material-symbols-outlined text-[10px]">mail</span> E-MAIL</span>` : `<span class="text-[10px] bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 rounded ml-2 font-bold flex items-center w-max gap-1"><span class="material-symbols-outlined text-[10px]">forum</span> CHAT</span>`;
                    let agentDisplay = `<select onchange="agentApp.reassignTicket('${t.id}', this.value)" class="mt-1 text-[10px] font-bold bg-slate-50 border border-slate-200 text-slate-600 rounded p-1 outline-none w-full max-w-[150px] relative z-30">${!t.agent_id ? '<option value="" selected>Na Fila (Aguardando)</option>' : '<option value="">Devolver para Fila</option>'}${agentApp.activeAgents.map(a => `<option value="${a.id}" ${a.id === t.agent_id ? 'selected' : ''}>${a.full_name}</option>`).join('')}</select>`;
                    let actionBtn = inProg && !isMine ? `<button onclick="agentApp.monitorTicket('${t.id}', '${t.protocol_number}')" class="bg-blue-100 text-blue-700 px-4 py-2.5 rounded-xl text-xs font-black hover:bg-blue-200 transition-all flex items-center gap-1 justify-center w-full relative z-30"><span class="material-symbols-outlined text-[16px]">visibility</span> Monitorar</button>` : `<button onclick="agentApp.pickTicket('${t.id}')" class="bg-slate-900 text-white px-5 py-2.5 rounded-xl text-xs font-black hover:bg-blue-600 transition-all relative z-30">Atender</button>`;
                    return `<tr class="hover:bg-slate-50 transition-colors relative z-20"><td class="p-5 font-black text-slate-900">HZ-${t.protocol_number} ${chBadge}</td><td class="p-5 font-black text-slate-900">${t.customers.full_name}<br><span class="text-[11px] font-bold text-slate-500">${t.ticket_subjects?.label || '---'}</span> ${agentDisplay}</td><td class="p-5">${statusHtml}</td><td class="p-5 text-right w-32">${actionBtn}</td></tr>`;
                }).join('');
            } else {
                gestorView.classList.add('hidden-view'); agentView.classList.remove('hidden-view');
                const myTickets = agentApp.activeTickets.filter(t => t.agent_id === agentApp.currentUser.id && t.status === 'in_progress');
                if(countEl) countEl.innerText = `${myTickets.length} tickets ativos`;
                const msgEl = agentView.querySelector('p');
                if (agentApp.currentUser.status !== 'online') { msgEl.innerHTML = `Você está <strong class="uppercase">${agentApp.currentUser.status}</strong>.<br>Mude para ONLINE para receber chamados da fila.`; } else { msgEl.innerHTML = `O Orquestrador enviará novos chamados automaticamente.<br>Fique atento às bolhas no cabeçalho da sua tela.`; }
            }
        } catch (e) { console.error("Falha ao renderizar fila:", e); }
    },

    async reassignTicket(ticketId, newAgentId) { 
        if(confirm("Deseja alterar o dono deste chamado?")) { await agentAPI.reassignTicket(ticketId, newAgentId); } else { await agentApp.loadQueue(); } 
    },

    async monitorTicket(ticketId, protocolNumber) {
        const modal = document.getElementById('modal-monitor'); const content = document.getElementById('monitor-chat-content');
        document.getElementById('modal-monitor-protocol').innerText = `Protocolo HZ-${protocolNumber}`; modal.classList.remove('hidden-view'); 
        content.innerHTML = '<div class="text-center text-slate-400 font-bold mt-4">Carregando a conversa...</div>';
        try {
            const ticket = await agentAPI.getTicketDetails(ticketId); const msgs = await agentAPI.getMessages(ticketId);
            let html = `<div class="bg-blue-50 border border-blue-100 p-4 rounded-xl mb-6 relative z-20"><h4 class="text-[10px] font-black text-blue-800 uppercase tracking-widest mb-3 flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">summarize</span> Resumo do Atendimento</h4><div class="grid grid-cols-2 gap-4 text-xs mb-3"><div><div class="font-bold text-blue-900 mb-1">Motivo (Tag 1):</div><div class="text-blue-700 bg-white border border-blue-100 px-2 py-1 rounded font-bold inline-block">${ticket.agent_tag1 || 'Não classificado'}</div></div><div><div class="font-bold text-blue-900 mb-1">Submotivo (Tag 2):</div><div class="text-blue-700 bg-white border border-blue-100 px-2 py-1 rounded font-bold inline-block">${ticket.agent_tag2 || 'Não classificado'}</div></div></div><div class="text-xs"><div class="font-bold text-blue-900 mb-1">Observações do Analista:</div><div class="text-blue-800 italic bg-white/60 border border-blue-100 p-3 rounded-lg">${ticket.agent_notes || 'Nenhuma observação registrada.'}</div></div></div><div class="h-px bg-slate-200 mb-4"></div>`;
            
            for (let m of msgs) {
                if(m.sender_type === 'customer') { m.content = await Translator.translateDynamic(m.content); }
                html += agentApp.formatMonitorMsg(m.content, m.sender_type, m.created_at, m.file_url, m.file_name, m.file_type);
            }
            
            content.innerHTML = html; content.scrollTop = content.scrollHeight;
            if (agentApp.monitorSub) agentApp.monitorSub.unsubscribe();
            agentApp.monitorSub = agentAPI.subscribeToAllMessages(ticketId, async (msgText, senderType, createdAt, fUrl, fName, fType) => { 
                if(senderType === 'customer') msgText = await Translator.translateDynamic(msgText);
                content.innerHTML += agentApp.formatMonitorMsg(msgText, senderType, createdAt, fUrl, fName, fType); content.scrollTop = content.scrollHeight; 
            });
        } catch(e) { content.innerHTML = '<div class="text-center text-red-400 font-bold mt-4">Erro de conexão.</div>'; }
    },

    formatMonitorMsg(text, type, createdAt, fileUrl = null, fileName = null, fileType = null) {
        const isAgent = type === 'agent' || type === 'system'; const timeStr = createdAt ? new Date(createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''; const mediaHtml = agentApp.buildMediaHtml(fileUrl, fileName, fileType);
        return `<div class="flex flex-col ${isAgent ? 'items-end' : 'items-start'} w-full mb-4"><div class="text-[9px] text-slate-400 font-bold mb-1 px-1">${type === 'system' ? 'Sistema Automático' : (isAgent ? 'Analista' : 'Cliente')} • ${timeStr}</div><div class="max-w-[85%] p-3 rounded-xl text-xs font-medium shadow-sm whitespace-pre-wrap ${isAgent ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-white border border-slate-200 text-slate-800 rounded-tl-none'}">${text}${mediaHtml}</div></div>`;
    },

    buildMediaHtml(fileUrl, fileName, fileType) {
        if (!fileUrl) return '';
        if (fileType && fileType.startsWith('image/')) { return `<div class="mt-2"><a href="${fileUrl}" target="_blank"><img src="${fileUrl}" class="max-w-[200px] h-auto rounded-lg border border-slate-300 hover:opacity-80 transition-opacity"></a></div>`; } 
        else { return `<div class="mt-2"><a href="${fileUrl}" target="_blank" download class="flex items-center gap-2 bg-black/10 p-2.5 rounded-lg text-xs font-bold hover:bg-black/20 transition-colors cursor-pointer relative z-30 w-max max-w-full truncate"><span class="material-symbols-outlined text-sm shrink-0">download</span> <span class="truncate">${fileName || 'Arquivo anexado'}</span></a></div>`; }
    },

    closeMonitor() { 
        document.getElementById('modal-monitor').classList.add('hidden-view'); 
        if (agentApp.monitorSub) { agentApp.monitorSub.unsubscribe(); agentApp.monitorSub = null; } 
    },

    async pickTicket(id) {
        try {
            agentApp.activeTicketId = id; agentApp.navigate('chat'); document.getElementById('menu-chat').classList.remove('hidden-view'); agentApp.switchTab('crm-info');
            let t = await agentAPI.getTicketDetails(id); agentApp.currentTicket = t;
            
            if (t.status === 'open' || !t.agent_id) {
                const myCount = agentApp.activeTickets.filter(tk => tk.status === 'in_progress' && tk.agent_id === agentApp.currentUser.id).length;
                if (myCount >= 10) { alert("Limite máximo simultâneo alcançado!"); agentApp.navigate('queue'); return; }
                await agentAPI.reassignTicket(id, agentApp.currentUser.id); t.status = 'in_progress'; t.agent_id = agentApp.currentUser.id; await agentApp.loadQueue(); 
            }

            agentApp.renderBubbles(); agentApp.currentCustomer = t.customers; 

            document.getElementById('toggle-upload').checked = t.is_upload_enabled || false; agentApp.updateUploadToggleUI(t.is_upload_enabled || false);
            document.getElementById('chat-header-name').innerText = t.customers?.full_name || 'Desconhecido'; document.getElementById('chat-header-protocol').innerText = `HZ-${t.protocol_number}`; 
            
            const isEmail = t.channel === 'email';
            document.getElementById('chat-header-channel').innerHTML = isEmail ? `<span class="material-symbols-outlined text-[14px]">mail</span> E-MAIL` : `<span class="material-symbols-outlined text-[14px]">forum</span> CHAT WEB`; 
            document.getElementById('chat-header-subject').innerText = `• ${t.ticket_subjects?.label || 'Sem assunto'}`;
            document.getElementById('crm-name').innerText = t.customers?.full_name || 'Desconhecido'; document.getElementById('crm-email').innerText = t.customers?.email || 'Sem e-mail'; 
            
            document.getElementById('crm-customer-tag').innerText = t.ticket_subjects?.label || 'Sem assunto';
            agentApp.allSubjects = await agentAPI.getAllSubjects(); agentApp.allSubsubjects = await agentAPI.getAllSubsubjects();
            
            const tag1Select = document.getElementById('crm-tag1');
            tag1Select.innerHTML = '<option value="">Selecione o Motivo Principal...</option>' + agentApp.allSubjects.map(s => `<option value="${s.label}">${s.label}</option>`).join('');
            document.getElementById('crm-tag2').innerHTML = '<option value="">Selecione o Submotivo...</option>';
            document.getElementById('crm-notes').value = t.agent_notes || '';

            agentApp.activeAgents = await agentAPI.getActiveAgents(); agentApp.populateTransferDropdowns();
            
            if (t.customers?.email) agentApp.loadCustomerHistory(t.customers.email); if (t.customer_id) agentApp.loadCustomerOrders(t.customer_id);

            const msgs = await agentAPI.getMessages(id);
            if (agentApp.messageSub) agentApp.messageSub.unsubscribe();

            if (Translator.currentLang !== 'pt') {
                for (let m of msgs) { if (m.sender_type === 'customer') m.content = await Translator.translateDynamic(m.content); }
            }

            if (isEmail) {
                document.getElementById('chat-mode-container').classList.add('hidden-view'); document.getElementById('email-mode-container').classList.remove('hidden-view');
                agentApp.renderEmailThread(t, msgs);
            } else {
                document.getElementById('email-mode-container').classList.add('hidden-view'); document.getElementById('chat-mode-container').classList.remove('hidden-view');
                document.getElementById('chat-history').innerHTML = '';
                msgs.forEach(m => agentApp.renderMsg(m.content, m.sender_type, m.file_url, m.file_name, m.file_type));

                agentApp.messageSub = agentAPI.subscribeToMessages(id, async (msgText, fUrl, fName, fType) => {
                    agentApp.playAlert('message'); // Som nova msg cliente
                    if (Translator.currentLang !== 'pt') msgText = await Translator.translateDynamic(msgText);
                    agentApp.renderMsg(msgText, 'customer', fUrl, fName, fType);
                    const tkIndex = agentApp.activeTickets.findIndex(tk => tk.id === id);
                    if (tkIndex > -1) { agentApp.activeTickets[tkIndex].last_sender = 'customer'; agentApp.activeTickets[tkIndex].last_interaction_at = new Date().toISOString(); agentApp.renderBubbles(); }
                });
            }
        } catch (e) { alert("Erro ao carregar chat."); }
    },

    filterTag2() {
        const tag1Label = document.getElementById('crm-tag1').value; const tag2Select = document.getElementById('crm-tag2');
        tag2Select.innerHTML = '<option value="">Selecione o Submotivo...</option>';
        if (!tag1Label) return;
        const parentSubject = agentApp.allSubjects.find(s => s.label === tag1Label);
        if (parentSubject) {
            const subs = agentApp.allSubsubjects.filter(ss => ss.subject_id === parentSubject.id);
            tag2Select.innerHTML += subs.map(ss => `<option value="${ss.label}">${ss.label}</option>`).join('');
        }
    },
    
    renderMsg(text, type, fileUrl = null, fileName = null, fileType = null) {
        const isAgent = type === 'agent' || type === 'system'; 
        let mediaHtml = '';
        if (fileUrl) {
            if (fileType && fileType.startsWith('image/')) mediaHtml = `<div class="mt-2"><a href="${fileUrl}" target="_blank"><img src="${fileUrl}" class="max-w-[200px] h-auto rounded-lg border border-slate-300 hover:opacity-80 transition-opacity"></a></div>`;
            else mediaHtml = `<div class="mt-2"><a href="${fileUrl}" target="_blank" download class="flex items-center gap-2 bg-black/10 p-2.5 rounded-lg text-xs font-bold w-max max-w-full truncate"><span class="material-symbols-outlined text-sm shrink-0">download</span> <span class="truncate">${fileName || 'Arquivo anexado'}</span></a></div>`;
        }
        
        const area = document.getElementById('chat-history'); if(!area) return;
        area.innerHTML += `<div class="flex ${isAgent ? 'justify-end' : 'justify-start'} w-full"><div class="max-w-[80%] p-4 rounded-2xl text-sm font-medium shadow-sm ${type === 'system' ? 'bg-slate-200 text-slate-700 italic border border-slate-300 text-center w-full max-w-full rounded-2xl my-2' : (isAgent ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-white text-slate-800 rounded-tl-none border border-slate-100')} relative z-30 whitespace-pre-wrap">${type === 'system' ? '<span class="material-symbols-outlined text-[14px] align-middle mr-1">info</span>' : ''}${text}${mediaHtml}</div></div>`;
        area.scrollTop = area.scrollHeight;
    },

    async closeTicket() {
        const tag1 = document.getElementById('crm-tag1').value; const tag2 = document.getElementById('crm-tag2').value; const notes = document.getElementById('crm-notes').value.trim();
        if (!tag1 || !tag2 || !notes) { alert("Obrigatório preencher Motivo, Submotivo e Observações."); return; }
        if (!confirm("Encerrar atendimento atual?")) return;
        try { await agentAPI.closeTicket(agentApp.activeTicketId, tag1, tag2, notes); agentApp.activeTicketId = null; document.getElementById('menu-chat').classList.add('hidden-view'); agentApp.navigate('queue'); Orchestrator.findAndClaimNext(); } catch (error) { alert("Erro ao fechar."); }
    },

    switchTab(tabId) { ['info', 'history', 'orders'].forEach(t => { document.getElementById(`view-crm-${t}`).classList.add('hidden-view'); document.getElementById(`tab-${t}`).classList.remove('border-blue-600', 'text-blue-600'); }); document.getElementById(`view-crm-${tabId.replace('crm-', '')}`).classList.remove('hidden-view'); document.getElementById(tabId.replace('crm-', 'tab-')).classList.add('border-blue-600', 'text-blue-600'); },
    populateTransferDropdowns() {
        const subSelect = document.getElementById('transfer-subject'); subSelect.innerHTML = '<option value="">➜ Para Fila (Assunto)...</option>'; agentApp.allSubjects.forEach(s => subSelect.innerHTML += `<option value="${s.id}">${s.label}</option>`);
        const agSelect = document.getElementById('transfer-agent'); agSelect.innerHTML = '<option value="">➜ Para Agente...</option>'; agentApp.activeAgents.forEach(a => { if (a.id !== agentApp.currentUser.id) { agSelect.innerHTML += `<option value="${a.id}">${a.full_name}</option>`; } });
    },
    async transferTicket() {
        const newSub = document.getElementById('transfer-subject').value; const newAg = document.getElementById('transfer-agent').value; const notes = document.getElementById('crm-notes').value.trim();
        if (!newSub && !newAg) return;
        if (confirm("Deseja transferir este chamado?")) { try { await agentAPI.transferTicket(agentApp.activeTicketId, newSub, newAg, notes); agentApp.activeTicketId = null; document.getElementById('menu-chat').classList.add('hidden-view'); agentApp.navigate('queue'); Orchestrator.findAndClaimNext(); } catch (e) { alert("Erro na transferência."); } }
    },

    async loadSettingsUI() {
        try {
            const cfg = await agentAPI.getSystemSettings();
            const qActive = document.getElementById('cfg-queue-active');
            if (qActive) {
                qActive.checked = cfg.is_queue_warning_active || false;
                document.getElementById('cfg-queue-min').value = cfg.queue_warning_min || 2;
                document.getElementById('cfg-queue-macro').value = cfg.queue_warning_macro || '';
            }
            document.getElementById('cfg-chat-warn-time').value = cfg.chat_warning_min || 8; 
            document.getElementById('cfg-chat-time').value = cfg.chat_timeout_min || 10;
            document.getElementById('cfg-email-warn-time').value = cfg.email_warning_hr || 24; 
            document.getElementById('cfg-email-time').value = cfg.email_timeout_hr || 48;
            document.getElementById('cfg-macro-warn-chat').value = cfg.warning_macro_chat || ''; 
            document.getElementById('cfg-macro-warn-email').value = cfg.warning_macro_email || ''; 
            document.getElementById('cfg-macro').value = cfg.closure_macro || '';
            
            agentApp.allSubjects = await agentAPI.getAllSubjects(); agentApp.allSubsubjects = await agentAPI.getAllSubsubjects(); agentApp.renderSettingsTags();
        } catch(e) { console.error("Erro UI de configurações", e); }
    },

    renderSettingsTags() {
        const container = document.getElementById('settings-tags-list'); if (!container) return;
        let html = '';
        agentApp.allSubjects.forEach(sub => {
            const subsubs = agentApp.allSubsubjects.filter(ss => ss.subject_id === sub.id);
            let subHtml = subsubs.map(ss => `<span class="bg-blue-50 text-blue-600 border border-blue-200 text-[10px] px-2 py-1 rounded font-bold flex items-center gap-1">${ss.label} <button onclick="agentApp.toggleSubsubject('${ss.id}', false)" class="hover:text-red-500 transition-colors flex items-center"><span class="material-symbols-outlined text-[12px]">close</span></button></span>`).join('');
            html += `<div class="border border-slate-200 rounded-xl p-5 bg-white relative z-20 shadow-sm"><div class="flex justify-between items-center mb-4 border-b border-slate-100 pb-3"><span class="font-black text-slate-800 text-base flex items-center gap-2"><span class="material-symbols-outlined text-slate-400">label</span> ${sub.label}</span><button onclick="agentApp.toggleSubject('${sub.id}', false)" class="text-xs text-red-500 font-bold flex items-center gap-1 hover:underline bg-red-50 px-2 py-1 rounded"><span class="material-symbols-outlined text-[14px]">delete</span> Excluir Motivo</button></div><div class="flex flex-wrap gap-2 mb-4">${subHtml || '<span class="text-xs text-slate-400 font-medium italic">Nenhum submotivo cadastrado.</span>'}</div><div class="flex gap-2"><input type="text" id="new-tag2-${sub.id}" class="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-xs font-medium outline-none focus:ring-2 focus:ring-blue-600" placeholder="Digite um novo Submotivo (Tag 2)..."><button onclick="agentApp.addTag2('${sub.id}')" class="bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 rounded-lg text-xs font-bold transition-colors">Adicionar Submotivo</button></div></div>`;
        });
        container.innerHTML = html;
    },

    async addTag1() { const input = document.getElementById('new-tag1-input'); const val = input.value.trim(); if(!val) return; try { await agentAPI.createSubject(val); input.value = ''; agentApp.allSubjects = await agentAPI.getAllSubjects(); agentApp.renderSettingsTags(); } catch(e) { alert("Erro."); } },
    async addTag2(subjectId) { const input = document.getElementById(`new-tag2-${subjectId}`); const val = input.value.trim(); if(!val) return; try { await agentAPI.createSubsubject(subjectId, val); input.value = ''; agentApp.allSubsubjects = await agentAPI.getAllSubsubjects(); agentApp.renderSettingsTags(); } catch(e) { alert("Erro."); } },
    async toggleSubject(id, isActive) { if(!isActive && !confirm("Deseja realmente excluir este Motivo Principal e todos os submotivos vinculados a ele?")) return; try { await agentAPI.toggleSubject(id, isActive); agentApp.allSubjects = await agentAPI.getAllSubjects(); agentApp.renderSettingsTags(); } catch(e) { alert("Erro ao excluir."); } },
    async toggleSubsubject(id, isActive) { try { await agentAPI.toggleSubsubject(id, isActive); agentApp.allSubsubjects = await agentAPI.getAllSubsubjects(); agentApp.renderSettingsTags(); } catch(e) { alert("Erro ao excluir submotivo."); } },
    insertMacroVar(variable, targetId = 'cfg-macro') { const txt = document.getElementById(targetId); if(!txt) return; const start = txt.selectionStart; const end = txt.selectionEnd; txt.value = txt.value.substring(0, start) + variable + txt.value.substring(end); txt.focus(); },

    async saveSettings() {
        const btn = document.getElementById('btn-save-cfg'); const origHtml = btn.innerHTML; btn.innerHTML = `<span class="material-symbols-outlined animate-spin">refresh</span> Salvando...`;
        try {
            const chatWarn = parseInt(document.getElementById('cfg-chat-warn-time').value) || 8; const chatClose = parseInt(document.getElementById('cfg-chat-time').value) || 10;
            const emailWarn = parseInt(document.getElementById('cfg-email-warn-time').value) || 24; const emailClose = parseInt(document.getElementById('cfg-email-time').value) || 48;

            if (chatWarn >= chatClose) { alert("ERRO: No Canal WEB, o tempo de Alerta deve ser MENOR que o tempo de Fechar."); return; }
            if (emailWarn >= emailClose) { alert("ERRO: No Canal E-mail, o tempo de Alerta deve ser MENOR que o tempo de Fechar."); return; }

            const payload = { chat_warning_min: chatWarn, chat_timeout_min: chatClose, email_warning_hr: emailWarn, email_timeout_hr: emailClose, warning_macro_chat: document.getElementById('cfg-macro-warn-chat').value, warning_macro_email: document.getElementById('cfg-macro-warn-email').value, closure_macro: document.getElementById('cfg-macro').value };
            const qActive = document.getElementById('cfg-queue-active');
            if (qActive) { payload.is_queue_warning_active = qActive.checked; payload.queue_warning_min = parseInt(document.getElementById('cfg-queue-min').value) || 2; payload.queue_warning_macro = document.getElementById('cfg-queue-macro').value; }
            
            await agentAPI.updateSystemSettings(payload); agentApp.systemSettings = Object.assign({}, agentApp.systemSettings, payload); alert("Configurações atualizadas com sucesso!");
        } catch (e) { alert("Erro ao salvar as configurações."); } finally { btn.innerHTML = origHtml; }
    },

    async loadTeam() {
        try {
            const team = await agentAPI.getTeamProfiles(); const logs = await agentAPI.getAgentLogsToday(); 
            agentApp.allTeamProfiles = team; agentApp.allTeamLogs = logs; agentApp.renderTeamTable();
        } catch (e) { console.error("Falha ao carregar equipe:", e); }
    },
    filterTeamTable() { agentApp.teamSearchQuery = document.getElementById('team-search').value.toLowerCase(); agentApp.renderTeamTable(); },
    renderTeamTable() {
        const tbody = document.getElementById('team-tbody'); if (!agentApp.allTeamProfiles) return;
        const filteredTeam = agentApp.allTeamProfiles.filter(m => m.full_name.toLowerCase().includes(agentApp.teamSearchQuery));

        tbody.innerHTML = filteredTeam.map(member => {
            let onlineSecs = agentApp.allTeamLogs.filter(l => l.agent_id === member.id && l.status === 'online').reduce((sum, l) => sum + (l.duration_seconds || 0), 0);
            let pausaSecs = agentApp.allTeamLogs.filter(l => l.agent_id === member.id && l.status === 'pausa').reduce((sum, l) => sum + (l.duration_seconds || 0), 0);
            let backSecs = agentApp.allTeamLogs.filter(l => l.agent_id === member.id && l.status === 'backoffice').reduce((sum, l) => sum + (l.duration_seconds || 0), 0);
            
            if (member.status && member.status_updated_at) {
                const currentSecs = Math.floor((Date.now() - new Date(member.status_updated_at).getTime()) / 1000);
                if (member.status === 'online') onlineSecs += currentSecs; if (member.status === 'pausa') pausaSecs += currentSecs; if (member.status === 'backoffice') backSecs += currentSecs;
            }
            
            const fmtTime = (secs) => { const h = Math.floor(secs / 3600); const m = Math.floor((secs % 3600) / 60); return `${h}h ${m}m`; };
            let statusBadge = member.status === 'online' ? '<span class="bg-green-100 text-green-700 px-2 py-0.5 rounded font-bold text-[10px]">ONLINE</span>' : member.status === 'pausa' ? '<span class="bg-amber-100 text-amber-700 px-2 py-0.5 rounded font-bold text-[10px]">EM PAUSA</span>' : member.status === 'backoffice' ? '<span class="bg-purple-100 text-purple-700 px-2 py-0.5 rounded font-bold text-[10px]">BACKOFFICE</span>' : '<span class="bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-bold text-[10px]">OFFLINE</span>';
            const timeHtml = `<div class="mb-2">${statusBadge}</div><div class="text-[10px] text-slate-500 font-bold space-y-0.5"><div><span class="text-green-600">Online:</span> ${fmtTime(onlineSecs)}</div><div><span class="text-amber-600">Pausa:</span> ${fmtTime(pausaSecs)}</div><div><span class="text-purple-600">Backoffice:</span> ${fmtTime(backSecs)}</div></div>`;
            
            const agentTickets = agentApp.activeTickets.filter(t => t.agent_id === member.id && t.status === 'in_progress');
            let chatAguardando = agentTickets.filter(t => t.channel === 'web' && t.last_sender !== 'agent').length; let chatBolha = agentTickets.filter(t => t.channel === 'web' && t.last_sender === 'agent').length;
            let emailAguardando = agentTickets.filter(t => t.channel === 'email' && t.last_sender !== 'agent').length; let emailBolha = agentTickets.filter(t => t.channel === 'email' && t.last_sender === 'agent').length;

            let ticketsBadge = '';
            if (member.can_web) ticketsBadge += `<div class="mt-2 bg-blue-50 text-blue-700 text-[10px] font-black px-2 py-1 rounded w-max border border-blue-100 flex items-center gap-1">CHAT: ${chatAguardando} ag. você | ${chatBolha} ag. cliente</div>`;
            if (member.can_email) ticketsBadge += `<div class="mt-1 bg-orange-50 text-orange-700 text-[10px] font-black px-2 py-1 rounded w-max border border-orange-100 flex items-center gap-1">E-MAIL: ${emailAguardando} ag. você | ${emailBolha} ag. cliente</div>`;

            let skillsHTML = '';
            if (member.is_approved) {
                let skillsBadges = ''; let availableOptions = '<option value="" disabled selected>+ Adicionar Assunto...</option>';
                agentApp.allSubjects.forEach(sub => {
                    const hasSkill = member.agent_skills.some(skill => skill.subject_id === sub.id);
                    if (hasSkill) { skillsBadges += `<span class="bg-slate-100 border border-slate-200 text-slate-600 text-[10px] px-2 py-1 rounded flex items-center gap-1 font-bold">${sub.label} <button onclick="agentApp.toggleSkill('${member.id}', '${sub.id}', false)" class="hover:text-red-500 transition-colors"><span class="material-symbols-outlined text-[12px]">close</span></button></span>`; } 
                    else { availableOptions += `<option value="${sub.id}">${sub.label}</option>`; }
                });

                skillsHTML = `<div class="flex flex-col gap-2"><div class="flex gap-4 border-b pb-2 border-slate-100"><label class="flex items-center gap-1 cursor-pointer"><input type="checkbox" ${member.can_web ? 'checked' : ''} onchange="agentApp.toggleChannel('${member.id}', 'web', this.checked)" class="w-3 h-3 text-blue-600"><span class="text-[10px] font-black text-slate-600">WEB (Chat)</span></label><label class="flex items-center gap-1 cursor-pointer"><input type="checkbox" ${member.can_email ? 'checked' : ''} onchange="agentApp.toggleChannel('${member.id}', 'email', this.checked)" class="w-3 h-3 text-blue-600"><span class="text-[10px] font-black text-slate-600">E-MAIL</span></label></div><div class="mt-2 flex gap-3 border-b border-slate-100 pb-2"><label class="text-[9px] font-bold text-slate-500 flex flex-col">Max Chats <input type="number" min="1" value="${member.max_chats || 3}" onchange="agentApp.updateAgentLimits('${member.id}', this.value, null)" class="border rounded px-1.5 py-0.5 mt-0.5 w-14 text-center"></label><label class="text-[9px] font-bold text-slate-500 flex flex-col">Max E-mails <input type="number" min="1" value="${member.max_emails || 5}" onchange="agentApp.updateAgentLimits('${member.id}', null, this.value)" class="border rounded px-1.5 py-0.5 mt-0.5 w-14 text-center"></label></div><div class="flex flex-wrap gap-1 min-h-[24px]">${skillsBadges || '<span class="text-[10px] text-slate-400 font-bold italic">Nenhum assunto</span>'}</div><select onchange="if(this.value) { agentApp.toggleSkill('${member.id}', this.value, true); this.value=''; }" class="bg-slate-50 border border-slate-200 text-slate-600 text-[10px] font-bold rounded p-1.5 outline-none w-full cursor-pointer hover:bg-slate-100 transition-colors">${availableOptions}</select></div>`;
            }

            const selStatus = `<select onchange="agentApp.forceAgentStatus('${member.id}', this.value)" class="text-[10px] font-bold bg-slate-50 border border-slate-200 text-slate-600 rounded p-1 outline-none w-full relative z-30 mb-2"><option value="online" ${member.status === 'online' ? 'selected' : ''}>Forçar Online</option><option value="pausa" ${member.status === 'pausa' ? 'selected' : ''}>Forçar Pausa</option><option value="backoffice" ${member.status === 'backoffice' ? 'selected' : ''}>Forçar Backoffice</option><option value="offline" ${member.status === 'offline' ? 'selected' : ''}>Forçar Offline</option></select>`;
            const chatBtn = member.id !== agentApp.currentUser.id ? `<button onclick="agentApp.openInternalChat('${member.id}', '${member.full_name}')" class="bg-slate-700 text-white px-3 py-1.5 rounded-lg text-[10px] font-black hover:bg-slate-800 transition-all flex items-center justify-center w-full gap-1"><span class="material-symbols-outlined text-[12px]">forum</span> Falar c/ Agente</button>` : '';
            const groupInput = `<input type="text" value="${member.team_group || 'Geral'}" onchange="agentApp.updateAgentGroup('${member.id}', this.value)" class="mt-2 text-[10px] font-bold text-slate-500 bg-slate-50 border border-slate-200 rounded p-1 w-full outline-none focus:border-blue-500" placeholder="Grupo/Equipe">`;

            return `<tr class="relative z-20 hover:bg-slate-50 transition-colors"><td class="p-5 font-black text-slate-900">${member.full_name}<div class="text-[10px] font-bold text-slate-400 mt-1 uppercase">${member.role}</div>${groupInput}${ticketsBadge}</td><td class="p-5">${timeHtml}</td><td class="p-5 w-[250px]">${skillsHTML}</td><td class="p-5 text-right w-36">${!member.is_approved ? `<button onclick="agentApp.approveMember('${member.id}')" class="bg-blue-600 text-white px-4 py-2 rounded font-bold text-xs mb-2">Aprovar</button>` : selStatus}${chatBtn}</td></tr>`;
        }).join('');
    },
    async openInternalChat(targetId = null, targetName = null) {
        if (targetId) { agentApp.internalChatTarget = targetId; document.getElementById('internal-chat-target-name').innerText = targetName; }
        document.getElementById('btn-internal-alert').classList.add('hidden-view'); document.getElementById('modal-internal-chat').classList.remove('hidden-view');
        const content = document.getElementById('internal-chat-content'); content.innerHTML = '<div class="text-center text-slate-400 text-xs font-bold">Carregando...</div>';
        try {
            if (!agentApp.internalChatTarget) throw new Error("ID não fornecido.");
            const msgs = await agentAPI.getInternalMessages(agentApp.currentUser.id, agentApp.internalChatTarget);
            content.innerHTML = ''; msgs.forEach(m => agentApp.renderInternalMsg(m, m.sender_id === agentApp.currentUser.id));
        } catch(e) { content.innerHTML = `<div class="text-center text-red-400 text-xs font-bold">Falha.</div>`; }
    },
    closeInternalChat() { document.getElementById('modal-internal-chat').classList.add('hidden-view'); },
    renderInternalMsg(msg, isMe) {
        const content = document.getElementById('internal-chat-content'); const timeStr = msg.created_at ? new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
        content.innerHTML += `<div class="flex ${isMe ? 'justify-end' : 'justify-start'} w-full"><div class="max-w-[85%] p-2 rounded-xl text-xs font-medium shadow-sm ${isMe ? 'bg-slate-800 text-white rounded-tr-none' : 'bg-white border text-slate-800 rounded-tl-none'}"><div class="whitespace-pre-wrap">${msg.content}</div><div class="text-[8px] text-right mt-1 opacity-60 font-bold">${timeStr}</div></div></div>`;
        content.scrollTop = content.scrollHeight;
    },
    async approveMember(id) { if(confirm("Aprovar analista?")) { await agentAPI.approveUser(id, 'analista'); agentApp.loadTeam(); } },
    async toggleChannel(agentId, channel, isEnabled) { try { await agentAPI.toggleChannel(agentId, channel, isEnabled); if (!isEnabled) { await agentAPI.releaseTicketsByChannel(agentId, channel); } agentApp.loadTeam(); } catch (e) { agentApp.loadTeam(); } },
    async toggleSkill(agentId, subjectId, isAdding) { try { await agentAPI.toggleAgentSkill(agentId, subjectId, isAdding); agentApp.loadTeam(); } catch (e) { agentApp.loadTeam(); } },
    
    async loadCustomerHistory(email) {
        try {
            const hist = await agentAPI.getCustomerHistoryByEmail(email); const container = document.getElementById('history-list');
            if(hist.length === 0) { container.innerHTML = '<div class="text-xs text-slate-400 font-bold">Nenhum atendimento anterior.</div>'; return; }
            container.innerHTML = hist.map(h => {
                const tagsHtml = h.agent_tag1 ? `<div class="mt-2 text-[10px]"><span class="bg-blue-100 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded font-bold">${h.agent_tag1}</span> <span class="bg-slate-100 text-slate-600 border border-slate-200 px-1.5 py-0.5 rounded font-bold">${h.agent_tag2 || ''}</span></div><div class="text-[10px] text-slate-500 mt-1 italic bg-slate-50 p-1.5 rounded">"${h.agent_notes || ''}"</div>` : '';
                return `<div class="p-3 bg-white border border-slate-200 rounded-xl flex justify-between items-start transition-all hover:border-blue-300 relative z-20"><div class="flex-1"><div class="flex justify-between items-center w-full"><div class="text-[10px] font-black text-blue-600">HZ-${h.protocol_number}</div><div class="text-[9px] font-bold text-slate-400">${new Date(h.created_at).toLocaleDateString()}</div></div><div class="text-[11px] font-bold text-slate-700 mt-1 truncate max-w-[200px]">Original: ${h.ticket_subjects?.label || 'Sem Assunto'}</div>${tagsHtml}</div><button onclick="agentApp.viewPastChat('${h.id}', '${h.protocol_number}')" title="Ver Conversa" class="ml-2 w-8 h-8 flex shrink-0 items-center justify-center bg-slate-50 border border-slate-200 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600 hover:border-blue-200 shadow-sm transition-all"><span class="material-symbols-outlined text-sm">visibility</span></button></div>`
            }).join('');
        } catch (e) {}
    },
    async loadCustomerOrders(customerId) {
        try {
            const orders = await agentAPI.getCustomerOrders(customerId); const container = document.getElementById('order-list');
            if(orders.length === 0) { container.innerHTML = '<div class="text-xs text-slate-400 font-bold">Sem pedidos.</div>'; return; }
            container.innerHTML = orders.map(o => `<div class="p-3 bg-white border border-dashed border-slate-300 rounded-xl flex justify-between items-center hover:bg-slate-50 transition-colors relative z-20"><div><div class="text-xs font-black text-slate-800">${o.product_name}</div><div class="text-[10px] font-bold text-slate-500">${o.quantity} un. • R$ ${o.amount.toFixed(2).replace('.', ',')}</div></div><div class="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-1 rounded">${new Date(o.created_at).toLocaleDateString()}</div></div>`).join('');
        } catch (e) {}
    },
    async viewPastChat(ticketId, protocolNumber) {
        try {
            const ticket = await agentAPI.getTicketDetails(ticketId); const msgs = await agentAPI.getMessages(ticketId); 
            const modal = document.getElementById('modal-history'); const content = document.getElementById('history-chat-content');
            document.getElementById('modal-history-protocol').innerText = `HZ-${protocolNumber}`; modal.classList.remove('hidden-view');
            let html = `<div class="bg-blue-50 border border-blue-100 p-4 rounded-xl mb-6 relative z-20"><h4 class="text-[10px] font-black text-blue-800 uppercase tracking-widest mb-3 flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">summarize</span> Resumo</h4><div class="grid grid-cols-2 gap-4 text-xs mb-3"><div><div class="font-bold text-blue-900 mb-1">Motivo:</div><div class="text-blue-700 bg-white border border-blue-100 px-2 py-1 rounded font-bold inline-block">${ticket.agent_tag1 || 'Não classificado'}</div></div><div><div class="font-bold text-blue-900 mb-1">Submotivo:</div><div class="text-blue-700 bg-white border border-blue-100 px-2 py-1 rounded font-bold inline-block">${ticket.agent_tag2 || 'Não classificado'}</div></div></div><div class="text-xs"><div class="font-bold text-blue-900 mb-1">Observações:</div><div class="text-blue-800 italic bg-white/60 border border-blue-100 p-3 rounded-lg">${ticket.agent_notes || '-'}</div></div></div><div class="h-px bg-slate-200 mb-4"></div>`;
            if(msgs.length === 0) { html += '<div class="text-center text-slate-400 font-bold">Sem mensagens.</div>'; } else { html += msgs.map(m => `<div class="flex ${m.sender_type === 'agent' || m.sender_type === 'system' ? 'justify-end' : 'justify-start'} w-full mb-4"><div class="max-w-[85%] p-3 rounded-xl text-xs font-medium shadow-sm whitespace-pre-wrap ${m.sender_type === 'agent' || m.sender_type === 'system' ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-white border border-slate-200 text-slate-800 rounded-tl-none'}">${m.content}</div></div>`).join(''); }
            content.innerHTML = html;
        } catch (e) { alert("Erro ao abrir histórico."); }
    }
};

App.init();