import { agentAPI } from './api.js';
import { supabase } from '../supabase.js';
import { Orchestrator } from './orchestrator.js';
import { Sidebar } from './sidebar.js';

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
    
    // DASHBOARD FILTERS
    dashboardTickets: [],
    allProfiles: [],
    dashFilterAgent: null,

    async init() {
        window.agentApp = this; 
        
        try {
            this.systemSettings = await agentAPI.getSystemSettings();
        } catch (e) {
            console.warn("Aviso: Configurações ausentes. Usando locais.");
            this.systemSettings = { is_orchestrator_active: false, chat_timeout_min: 10, email_timeout_hr: 24, closure_macro: "Encerrado." };
        }

        // Set default dates for Dashboard
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        document.getElementById('dash-start').value = firstDay.toISOString().split('T')[0];
        document.getElementById('dash-end').value = today.toISOString().split('T')[0];

        this.startLiveTimers(); 

        window.addEventListener('ticket-assigned', async (e) => { 
            await this.loadQueue(); 
            if (!this.activeTicketId) {
                this.pickTicket(e.detail.id); 
            }
        });

        document.getElementById('login-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('btn-login'); 
            const originalText = btn.innerHTML;
            btn.innerHTML = `<span class="material-symbols-outlined animate-spin">refresh</span> Processando...`;
            
            const email = document.getElementById('login-email').value; 
            const pass = document.getElementById('login-pass').value;

            if (this.isRegisterMode) {
                try { 
                    await agentAPI.register(document.getElementById('reg-name').value, email, pass); 
                    alert("Aguarde aprovação."); 
                    this.toggleAuthMode(); 
                } catch (err) { 
                    alert("Erro: " + err.message); 
                } finally { 
                    btn.innerHTML = originalText; 
                }
                return;
            }

            try {
                const authData = await agentAPI.login(email, pass);
                const { data: profile } = await supabase.from('profiles').select('*').eq('id', authData.user.id).single();
                
                if (!profile || !profile.is_approved) { 
                    alert("Acesso pendente."); 
                    await supabase.auth.signOut(); 
                    btn.innerHTML = originalText; 
                    return; 
                }
                
                this.currentUser = profile; 
                document.getElementById('view-login').classList.add('hidden-view'); 
                document.getElementById('view-app').classList.remove('hidden-view');
                
                this.allSubjects = await agentAPI.getAllSubjects(); 
                this.allSubsubjects = await agentAPI.getAllSubsubjects();
                this.activeAgents = await agentAPI.getActiveAgents();
                
                Sidebar.render('sidebar-root', profile.role);
                this.applyWatermark(profile.full_name);

                if (profile.role === 'gestor') { 
                    document.getElementById('wrapper-routing').classList.remove('hidden-view'); 
                    document.getElementById('btn-settings').classList.remove('hidden-view'); 
                    
                    const toggleRouteBtn = document.getElementById('toggle-routing');
                    if (toggleRouteBtn) {
                        toggleRouteBtn.checked = this.systemSettings.is_orchestrator_active;
                    }
                    this.renderDashboard(); 
                }
                
                const statusSelect = document.getElementById('agent-status-select');
                if(statusSelect) statusSelect.value = profile.status || 'online';

                const shouldRouteLocal = profile.status === 'online';
                Orchestrator.init(profile.id, this.systemSettings);
                Orchestrator.setStatus(shouldRouteLocal);

                await this.loadQueue();

                agentAPI.subscribeToQueue(() => {
                    this.loadQueue();
                    if (this.currentUser && this.currentUser.status === 'online') {
                        Orchestrator.findAndClaimNext();
                    }
                    if (document.getElementById('sec-dashboard') && !document.getElementById('sec-dashboard').classList.contains('hidden-view')) {
                        this.renderDashboard();
                    }
                    if (document.getElementById('sec-team') && !document.getElementById('sec-team').classList.contains('hidden-view')) {
                        this.loadTeam();
                    }
                });

                agentAPI.subscribeToSettings((newCfg) => {
                    this.systemSettings = newCfg;
                    Orchestrator.updateSettings(newCfg);
                    if (profile.role === 'gestor') {
                        const tg = document.getElementById('toggle-routing');
                        if (tg) tg.checked = newCfg.is_orchestrator_active;
                    }
                });

                agentAPI.subscribeToProfiles(() => {
                    if (!document.getElementById('sec-team').classList.contains('hidden-view')) {
                        this.loadTeam();
                    }
                });

                agentAPI.subscribeToMyProfile(this.currentUser.id, (newProfile) => {
                    if (newProfile.status !== this.currentUser.status) {
                        this.currentUser.status = newProfile.status;
                        const sel = document.getElementById('agent-status-select');
                        if (sel) sel.value = newProfile.status;
                        
                        if (newProfile.status !== 'online') {
                            Orchestrator.setStatus(false);
                            this.activeTicketId = null;
                            document.getElementById('menu-chat').classList.add('hidden-view');
                            this.navigate('queue');
                            alert("Atenção: Seu status foi alterado para " + newProfile.status.toUpperCase() + " pelo Gestor.");
                            this.loadQueue();
                        } else {
                            Orchestrator.setStatus(true);
                            this.loadQueue();
                        }
                    }
                });

                agentAPI.subscribeToInternalMessages(this.currentUser.id, async (msg) => {
                    if (document.getElementById('modal-internal-chat').classList.contains('hidden-view') || this.internalChatTarget !== msg.sender_id) {
                        const alertBtn = document.getElementById('btn-internal-alert');
                        if (alertBtn) {
                            alertBtn.classList.remove('hidden-view');
                            try {
                                const { data: sender } = await supabase.from('profiles').select('full_name').eq('id', msg.sender_id).single();
                                alertBtn.dataset.senderId = msg.sender_id;
                                alertBtn.dataset.senderName = sender?.full_name || 'Equipe';
                            } catch(e) { console.error(e); }
                        }
                    } else {
                        this.renderInternalMsg(msg, false);
                    }
                });

            } catch (error) { 
                alert("Erro no login: " + error.message); 
                btn.innerHTML = originalText; 
            }
        });

        document.getElementById('agent-chat-form')?.addEventListener('submit', async (e) => {
            e.preventDefault(); 
            const input = document.getElementById('chat-input'); 
            const text = input.value.trim();
            if(!text || !this.activeTicketId) return;
            
            this.renderMsg(text, 'agent'); 
            input.value = '';
            
            try { 
                await agentAPI.sendMessage(this.activeTicketId, text); 
                this.updateLocalBubble();
                Orchestrator.findAndClaimNext(); 
            } catch(err) { 
                alert("Erro ao enviar mensagem."); 
            }
        });

        document.getElementById('agent-email-form')?.addEventListener('submit', async (e) => {
            e.preventDefault(); 
            const input = document.getElementById('email-input'); 
            const text = input.value.trim();
            if(!text || !this.activeTicketId) return;
            
            if(!confirm("Prosseguir com a resposta ao cliente? O atendimento sairá da sua tela e retornará à fila em caso de resposta do cliente.")) return;
            
            const btn = document.getElementById('btn-send-email'); 
            const origHTML = btn.innerHTML;
            btn.innerHTML = `<span class="material-symbols-outlined animate-spin text-[18px]">refresh</span> Enviando...`; 
            btn.disabled = true;
            
            try {
                await agentAPI.sendMessage(this.activeTicketId, text); 
                input.value = ''; 
                
                await agentAPI.closeTicket(this.activeTicketId, '', '', 'E-mail respondido (Aguardando cliente)');
                
                this.activeTickets = this.activeTickets.filter(t => t.id !== this.activeTicketId);
                this.activeTicketId = null;
                document.getElementById('menu-chat').classList.add('hidden-view');
                this.navigate('queue');
                this.loadQueue();
                Orchestrator.findAndClaimNext();

            } catch(err) { 
                alert("Erro ao responder o e-mail."); 
            } finally { 
                btn.innerHTML = origHTML; 
                btn.disabled = false; 
            }
        });

        document.getElementById('toggle-upload')?.addEventListener('change', (e) => { 
            this.toggleClientUpload(e.target.checked); 
        });
        
        this.setupAgentAttachment('btn-agent-attach', 'agent-file-input'); 
        this.setupAgentAttachment('btn-email-attach', 'email-file-input', true);
        
        document.getElementById('agent-status-select')?.addEventListener('change', (e) => { 
            this.updateMyStatus(e.target.value); 
        });
        
        document.getElementById('internal-chat-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const input = document.getElementById('internal-chat-input'); 
            const text = input.value.trim();
            if (!text || !this.internalChatTarget) return;
            try {
                await agentAPI.sendInternalMessage(this.currentUser.id, this.internalChatTarget, text);
                this.renderInternalMsg({ content: text }, true);
                input.value = '';
            } catch (err) { 
                alert("Erro ao enviar mensagem interna."); 
            }
        });
    },

    async toggleGlobalOrchestrator(isActive) {
        try {
            await agentAPI.updateSystemSettings({ is_orchestrator_active: isActive });
        } catch (e) {
            document.getElementById('toggle-routing').checked = !isActive;
            alert("Erro ao alterar Orquestrador.");
        }
    },

    setupAgentAttachment(btnId, inputId, isEmail = false) {
        const btn = document.getElementById(btnId); 
        const input = document.getElementById(inputId);
        if (btn && input) {
            btn.addEventListener('click', () => input.click());
            input.addEventListener('change', async (e) => {
                const file = e.target.files[0]; 
                if(!file || !this.activeTicketId) return;
                
                const sendBtnId = isEmail ? 'btn-send-email' : 'btn-send-chat';
                const btnSend = document.getElementById(sendBtnId); 
                const origText = btnSend.innerHTML;
                btnSend.innerHTML = `<span class="material-symbols-outlined animate-spin">refresh</span>`; 
                btnSend.disabled = true;
                
                try {
                    const fileData = await agentAPI.uploadFile(file);
                    await agentAPI.sendMessage(this.activeTicketId, "📎 Anexo enviado pelo Analista:", fileData);
                    this.updateLocalBubble();
                    
                    if (isEmail) { 
                        const msgs = await agentAPI.getMessages(this.activeTicketId); 
                        this.renderEmailThread(this.currentTicket, msgs); 
                    } else { 
                        this.renderMsg("📎 Anexo enviado:", 'agent', fileData.url, fileData.name, fileData.type); 
                    }
                } catch(err) { 
                    alert("Erro no upload."); 
                } finally { 
                    btnSend.innerHTML = origText; 
                    btnSend.disabled = false; 
                    e.target.value = ''; 
                }
            });
        }
    },

    updateLocalBubble() {
        const tkIndex = this.activeTickets.findIndex(t => t.id === this.activeTicketId);
        if (tkIndex > -1) { 
            this.activeTickets[tkIndex].last_sender = 'agent'; 
            this.activeTickets[tkIndex].last_interaction_at = new Date().toISOString(); 
            this.renderBubbles(); 
        }
    },

    async updateMyStatus(newStatus) {
        if (!this.currentUser) return;
        try {
            await agentAPI.changeStatus(this.currentUser.id, newStatus);
            this.currentUser.status = newStatus;
            
            if (newStatus !== 'online') {
                await agentAPI.releaseMyTickets(this.currentUser.id);
                Orchestrator.setStatus(false);
                alert(`Status alterado para ${newStatus.toUpperCase()}. Seus atendimentos retornaram para a fila.`);
                
                this.activeTicketId = null;
                document.getElementById('menu-chat').classList.add('hidden-view');
                this.navigate('queue');
                this.loadQueue();
            } else {
                Orchestrator.setStatus(true);
                this.loadQueue();
            }
        } catch (e) { 
            alert("Erro ao mudar o status."); 
        }
    },

    async forceAgentStatus(agentId, newStatus) {
        if(!confirm(`Deseja forçar o status para ${newStatus.toUpperCase()}? Os tickets em andamento serão devolvidos à fila.`)) return;
        try {
            await agentAPI.changeStatus(agentId, newStatus);
            if (newStatus !== 'online') {
                await agentAPI.releaseMyTickets(agentId);
            }
            this.loadTeam();
        } catch(e) { 
            alert("Erro ao alterar status do agente."); 
        }
    },

    async updateAgentLimits(agentId, maxChats, maxEmails) {
        try {
            let c = maxChats === "" ? null : maxChats;
            let e = maxEmails === "" ? null : maxEmails;
            await agentAPI.updateAgentLimits(agentId, c, e);
        } catch (e) {
            alert("Erro ao atualizar limites do agente.");
        }
    },

    applyWatermark(name) {
        const wm = document.createElement('div');
        wm.className = 'fixed inset-0 pointer-events-none flex flex-wrap overflow-hidden justify-center items-center select-none';
        wm.style.zIndex = '99999'; 
        let spans = '';
        for(let i=0; i<150; i++) spans += `<span class="transform -rotate-45 text-2xl font-black text-slate-900 m-8 opacity-[0.03]">${name}</span>`;
        wm.innerHTML = spans; 
        document.body.appendChild(wm);
    },

    async logout() {
        if(confirm("Deseja sair? Seus atendimentos em andamento voltarão para a fila!")) {
            try { 
                await agentAPI.releaseMyTickets(this.currentUser.id); 
                await agentAPI.changeStatus(this.currentUser.id, 'offline'); 
                await supabase.auth.signOut(); 
                location.reload(); 
            } catch(e) { 
                alert("Erro ao deslogar."); 
            }
        }
    },

    startLiveTimers() {
        if (this.timerInterval) clearInterval(this.timerInterval);
        
        this.timerInterval = setInterval(() => {
            document.querySelectorAll('.live-timer').forEach(el => {
                const diffSeconds = Math.max(0, Math.floor((Date.now() - new Date(el.dataset.time).getTime()) / 1000));
                const h = String(Math.floor(diffSeconds / 3600)).padStart(2, '0'); 
                const m = String(Math.floor((diffSeconds % 3600) / 60)).padStart(2, '0'); 
                const s = String(diffSeconds % 60).padStart(2, '0');
                
                el.innerText = `${h}:${m}:${s}`;
                
                if (diffSeconds > 600) { 
                    el.classList.remove('text-slate-600'); 
                    el.classList.add('text-red-600'); 
                }
            });

            if (this.systemSettings && this.currentUser) {
                const chatLimitSecs = this.systemSettings.chat_timeout_min * 60;
                const emailLimitSecs = this.systemSettings.email_timeout_hr * 3600;

                this.activeTickets.forEach(t => {
                    if (t.agent_id !== this.currentUser.id) return;
                    
                    const lastTime = new Date(t.last_interaction_at || t.created_at).getTime();
                    const diffSeconds = Math.floor((Date.now() - lastTime) / 1000);
                    
                    const el = document.getElementById(`bubble-${t.id}`);
                    if (el) {
                        if (t.last_sender === 'customer') {
                            el.style.backgroundColor = '#2563eb'; 
                            el.style.color = '#ffffff'; 
                            el.classList.add('animate-pulse');
                        } else {
                            el.classList.remove('animate-pulse');
                            const diffMinutes = Math.floor(diffSeconds / 60);
                            const maxFadingMins = t.channel === 'web' ? this.systemSettings.chat_timeout_min : 60; 
                            
                            const opacity = Math.max(0.15, 1 - (diffMinutes / maxFadingMins));
                            el.style.backgroundColor = `rgba(37, 99, 235, ${opacity})`;
                            el.style.color = opacity < 0.4 ? '#1e3a8a' : '#ffffff';
                        }
                    }

                    if (t.last_sender === 'agent' && !this.closingTickets.has(t.id)) {
                        const isWebClose = t.channel === 'web' && diffSeconds >= chatLimitSecs;
                        const isEmailClose = t.channel === 'email' && diffSeconds >= emailLimitSecs;

                        if (isWebClose || isEmailClose) {
                            this.closingTickets.add(t.id);
                            this.executeAutoClose(t);
                        }
                    }
                });
            }
        }, 1000);
    },

    async executeAutoClose(ticket) {
        try {
            let msg = this.systemSettings.closure_macro;
            msg = msg.replace(/\[nome do cliente\]/g, ticket.customers?.full_name || 'Cliente');
            msg = msg.replace(/\[protocolo\]/g, ticket.protocol_number);

            await agentAPI.sendMessage(ticket.id, msg);
            await agentAPI.closeTicket(ticket.id, 'SLA', 'SLA', 'Encerrado Automaticamente por Inatividade');
            
            this.activeTickets = this.activeTickets.filter(t => t.id !== ticket.id);
            if (this.activeTicketId === ticket.id) {
                this.activeTicketId = null; 
                document.getElementById('menu-chat').classList.add('hidden-view'); 
                this.navigate('queue');
            }
            this.loadQueue();
        } catch(e) { 
            console.error("Falha macro:", e); 
        } finally { 
            this.closingTickets.delete(ticket.id); 
        }
    },

    renderBubbles() {
        const container = document.getElementById('bubble-container'); 
        if(!container) return;
        
        const myTickets = this.activeTickets
            .filter(t => t.status === 'in_progress' && t.agent_id === this.currentUser.id)
            .sort((a, b) => new Date(a.last_interaction_at || a.created_at).getTime() - new Date(b.last_interaction_at || b.created_at).getTime());
        
        container.innerHTML = myTickets.map(t => {
            const initial = t.customers?.full_name ? t.customers.full_name.charAt(0).toUpperCase() : 'C';
            return `
            <div id="bubble-${t.id}" onclick="agentApp.pickTicket('${t.id}')" 
                 class="chat-bubble cursor-pointer text-lg font-black w-10 h-10 rounded-full flex items-center justify-center shadow-md transition-all hover:scale-110 shrink-0 border-2 ${this.activeTicketId === t.id ? 'border-slate-800' : 'border-transparent'}" 
                 data-sender="${t.last_sender || 'customer'}" 
                 data-time="${t.last_interaction_at || t.created_at}" 
                 title="${t.customers?.full_name || 'Cliente'} (HZ-${t.protocol_number})">
                 ${initial}
            </div>`
        }).join('');
    },

    toggleAuthMode() {
        this.isRegisterMode = !this.isRegisterMode;
        document.getElementById('auth-title').innerText = this.isRegisterMode ? "Solicitar Acesso" : "Acesso Restrito";
        document.getElementById('btn-login').innerHTML = this.isRegisterMode ? 'Criar Conta' : 'Entrar <span class="material-symbols-outlined">login</span>';
        
        const regName = document.getElementById('reg-name');
        if (this.isRegisterMode) { 
            regName.classList.remove('hidden-view'); 
            regName.required = true; 
        } else { 
            regName.classList.add('hidden-view'); 
            regName.required = false; 
        }
    },

    navigate(target) {
        ['queue', 'chat', 'team', 'dashboard', 'settings'].forEach(s => { 
            const el = document.getElementById(`sec-${s}`); 
            if(el) el.classList.add('hidden-view'); 
        });
        
        document.getElementById(`sec-${target}`).classList.remove('hidden-view');
        
        if (target === 'team') this.loadTeam(); 
        if (target === 'dashboard') this.renderDashboard(); 
        if (target === 'settings') this.loadSettingsUI();
    },

    async loadSettingsUI() {
        try {
            const cfg = await agentAPI.getSystemSettings();
            document.getElementById('cfg-chat-time').value = cfg.chat_timeout_min || 10;
            document.getElementById('cfg-email-time').value = cfg.email_timeout_hr || 24;
            document.getElementById('cfg-macro').value = cfg.closure_macro || '';
            
            this.allSubjects = await agentAPI.getAllSubjects();
            this.allSubsubjects = await agentAPI.getAllSubsubjects();
            this.renderSettingsTags();

        } catch(e) { console.error("Erro UI de configurações", e); }
    },

    renderSettingsTags() {
        const container = document.getElementById('settings-tags-list');
        if (!container) return;

        let html = '';
        this.allSubjects.forEach(sub => {
            const subsubs = this.allSubsubjects.filter(ss => ss.subject_id === sub.id);
            let subHtml = subsubs.map(ss => `
                <span class="bg-blue-50 text-blue-600 border border-blue-200 text-[10px] px-2 py-1 rounded font-bold flex items-center gap-1">
                    ${ss.label} 
                    <button onclick="agentApp.toggleSubsubject('${ss.id}', false)" class="hover:text-red-500 transition-colors flex items-center"><span class="material-symbols-outlined text-[12px]">close</span></button>
                </span>
            `).join('');
            
            html += `
            <div class="border border-slate-200 rounded-xl p-5 bg-white relative z-20 shadow-sm">
                <div class="flex justify-between items-center mb-4 border-b border-slate-100 pb-3">
                    <span class="font-black text-slate-800 text-base flex items-center gap-2"><span class="material-symbols-outlined text-slate-400">label</span> ${sub.label}</span>
                    <button onclick="agentApp.toggleSubject('${sub.id}', false)" class="text-xs text-red-500 font-bold flex items-center gap-1 hover:underline bg-red-50 px-2 py-1 rounded"><span class="material-symbols-outlined text-[14px]">delete</span> Excluir Motivo</button>
                </div>
                <div class="flex flex-wrap gap-2 mb-4">${subHtml || '<span class="text-xs text-slate-400 font-medium italic">Nenhum submotivo cadastrado.</span>'}</div>
                <div class="flex gap-2">
                    <input type="text" id="new-tag2-${sub.id}" class="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-xs font-medium outline-none focus:ring-2 focus:ring-blue-600" placeholder="Digite um novo Submotivo (Tag 2)...">
                    <button onclick="agentApp.addTag2('${sub.id}')" class="bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 rounded-lg text-xs font-bold transition-colors">Adicionar Submotivo</button>
                </div>
            </div>`;
        });
        container.innerHTML = html;
    },

    async addTag1() {
        const input = document.getElementById('new-tag1-input');
        const val = input.value.trim();
        if(!val) return;
        try {
            await agentAPI.createSubject(val);
            input.value = '';
            this.allSubjects = await agentAPI.getAllSubjects();
            this.renderSettingsTags();
        } catch(e) { alert("Erro ao criar Motivo."); }
    },

    async addTag2(subjectId) {
        const input = document.getElementById(`new-tag2-${subjectId}`);
        const val = input.value.trim();
        if(!val) return;
        try {
            await agentAPI.createSubsubject(subjectId, val);
            input.value = '';
            this.allSubsubjects = await agentAPI.getAllSubsubjects();
            this.renderSettingsTags();
        } catch(e) { alert("Erro ao criar Submotivo."); }
    },

    async toggleSubject(id, isActive) {
        if(!isActive && !confirm("Deseja realmente excluir este Motivo Principal?")) return;
        try { 
            await agentAPI.toggleSubject(id, isActive); 
            this.allSubjects = await agentAPI.getAllSubjects(); 
            this.renderSettingsTags(); 
        } catch(e) { alert("Erro ao excluir."); }
    },

    async toggleSubsubject(id, isActive) {
        try { 
            await agentAPI.toggleSubsubject(id, isActive); 
            this.allSubsubjects = await agentAPI.getAllSubsubjects(); 
            this.renderSettingsTags(); 
        } catch(e) { alert("Erro ao excluir submotivo."); }
    },

    insertMacroVar(variable) {
        const txt = document.getElementById('cfg-macro');
        const start = txt.selectionStart; 
        const end = txt.selectionEnd;
        txt.value = txt.value.substring(0, start) + variable + txt.value.substring(end); 
        txt.focus();
    },

    async saveSettings() {
        const btn = document.getElementById('btn-save-cfg');
        btn.innerHTML = `<span class="material-symbols-outlined animate-spin">refresh</span> Salvando...`;
        try {
            const payload = { 
                chat_timeout_min: parseInt(document.getElementById('cfg-chat-time').value), 
                email_timeout_hr: parseInt(document.getElementById('cfg-email-time').value), 
                closure_macro: document.getElementById('cfg-macro').value 
            };
            await agentAPI.updateSystemSettings(payload); 
            this.systemSettings = payload; 
            alert("Configurações atualizadas!");
        } catch (e) { 
            alert("Erro ao salvar as configurações."); 
        } finally { 
            btn.innerHTML = `<span class="material-symbols-outlined">save</span> Salvar Configurações Gerais`; 
        }
    },

    async toggleClientUpload(isEnabled) { 
        try { 
            await agentAPI.toggleUpload(this.activeTicketId, isEnabled); 
            this.updateUploadToggleUI(isEnabled); 
        } catch(e) { 
            alert("Erro de permissão ao ativar anexo."); 
            document.getElementById('toggle-upload').checked = !isEnabled; 
        } 
    },
    
    updateUploadToggleUI(isEnabled) {
        const textEl = document.getElementById('upload-status-text'); 
        if(!textEl) return;
        textEl.innerText = isEnabled ? 'Anexos (Cli): Lib' : 'Anexos (Cli): Off'; 
        textEl.className = `text-[10px] font-bold uppercase ${isEnabled ? 'text-blue-600' : 'text-slate-400'}`;
    },

    async loadQueue() {
        this.activeTickets = await agentAPI.getPendingTickets();
        const isGestor = this.currentUser.role === 'gestor';
        const gestorView = document.getElementById('queue-gestor-view');
        const agentView = document.getElementById('queue-agent-view');
        const countEl = document.getElementById('queue-count');
        const tbody = document.getElementById('queue-tbody');

        this.renderBubbles();

        if (isGestor) {
            gestorView.classList.remove('hidden-view');
            agentView.classList.add('hidden-view');
            
            const tickets = this.activeTickets;
            if(countEl) countEl.innerText = `${tickets.length} tickets ativos`;
            
            if (tickets.length === 0) {
                tbody.innerHTML = `<tr><td colspan="4" class="p-10 text-center text-slate-300 font-bold">Nenhum ticket na fila no momento.</td></tr>`;
                return;
            }

            tbody.innerHTML = tickets.map(t => {
                const inProg = t.status === 'in_progress';
                const isMine = t.agent_id === this.currentUser.id;
                
                let statusHtml = `
                <div class="flex flex-col gap-1 items-start">
                    ${inProg ? `<span class="bg-amber-100 text-amber-700 text-[10px] px-2 py-0.5 rounded font-bold">Em Atendimento</span>` : `<span class="bg-blue-100 text-blue-700 text-[10px] px-2 py-0.5 rounded font-bold">Aguardando Fila</span>`}
                    <span class="live-timer text-xs font-black font-mono text-slate-600" data-time="${t.created_at}">--:--:--</span>
                </div>`;
                
                let chBadge = t.channel === 'email' 
                    ? `<span class="text-[10px] bg-orange-100 text-orange-700 border border-orange-200 px-2 py-0.5 rounded ml-2 font-bold flex items-center w-max gap-1"><span class="material-symbols-outlined text-[10px]">mail</span> E-MAIL</span>` 
                    : `<span class="text-[10px] bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 rounded ml-2 font-bold flex items-center w-max gap-1"><span class="material-symbols-outlined text-[10px]">forum</span> CHAT</span>`;

                let agentDisplay = `
                <select onchange="agentApp.reassignTicket('${t.id}', this.value)" class="mt-1 text-[10px] font-bold bg-slate-50 border border-slate-200 text-slate-600 rounded p-1 outline-none w-full max-w-[150px] relative z-30">
                    ${!t.agent_id ? '<option value="" selected>Na Fila (Aguardando)</option>' : '<option value="">Devolver para Fila</option>'}
                    ${this.activeAgents.map(a => `<option value="${a.id}" ${a.id === t.agent_id ? 'selected' : ''}>${a.full_name}</option>`).join('')}
                </select>`;
                
                let actionBtn = inProg && !isMine 
                    ? `<button onclick="agentApp.monitorTicket('${t.id}', '${t.protocol_number}')" class="bg-blue-100 text-blue-700 px-4 py-2.5 rounded-xl text-xs font-black hover:bg-blue-200 transition-all flex items-center gap-1 justify-center w-full relative z-30"><span class="material-symbols-outlined text-[16px]">visibility</span> Monitorar</button>` 
                    : `<button onclick="agentApp.pickTicket('${t.id}')" class="bg-slate-900 text-white px-5 py-2.5 rounded-xl text-xs font-black hover:bg-blue-600 transition-all relative z-30">Atender</button>`;

                return `
                <tr class="hover:bg-slate-50 transition-colors relative z-20">
                    <td class="p-5 font-black text-slate-900">HZ-${t.protocol_number} ${chBadge}</td>
                    <td class="p-5 font-black text-slate-900">${t.customers.full_name}<br><span class="text-[11px] font-bold text-slate-500">${t.ticket_subjects?.label || '---'}</span> ${agentDisplay}</td>
                    <td class="p-5">${statusHtml}</td>
                    <td class="p-5 text-right w-32">${actionBtn}</td>
                </tr>`;
            }).join('');
        } else {
            gestorView.classList.add('hidden-view');
            agentView.classList.remove('hidden-view');
            
            const myTickets = this.activeTickets.filter(t => t.agent_id === this.currentUser.id && t.status === 'in_progress');
            if(countEl) countEl.innerText = `${myTickets.length} tickets ativos`;
            
            const msgEl = agentView.querySelector('p');
            if (this.currentUser.status !== 'online') {
                msgEl.innerHTML = `Você está <strong class="uppercase">${this.currentUser.status}</strong>.<br>Mude para ONLINE para receber chamados da fila.`;
            } else {
                msgEl.innerHTML = `O Orquestrador enviará novos chamados automaticamente.<br>Fique atento às bolhas no cabeçalho da sua tela.`;
            }
        }
    },

    async reassignTicket(ticketId, newAgentId) { 
        if(confirm("Deseja alterar o dono deste chamado?")) { 
            await agentAPI.reassignTicket(ticketId, newAgentId); 
        } else { 
            this.loadQueue(); 
        } 
    },

    async monitorTicket(ticketId, protocolNumber) {
        const modal = document.getElementById('modal-monitor'); 
        const content = document.getElementById('monitor-chat-content');
        document.getElementById('modal-monitor-protocol').innerText = `Protocolo HZ-${protocolNumber}`; 
        
        modal.classList.remove('hidden-view'); 
        content.innerHTML = '<div class="text-center text-slate-400 font-bold mt-4">Carregando a conversa...</div>';
        
        try {
            const ticket = await agentAPI.getTicketDetails(ticketId); 
            const msgs = await agentAPI.getMessages(ticketId);
            
            let html = `
            <div class="bg-blue-50 border border-blue-100 p-4 rounded-xl mb-6 relative z-20">
                <h4 class="text-[10px] font-black text-blue-800 uppercase tracking-widest mb-3 flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">summarize</span> Resumo do Atendimento</h4>
                <div class="grid grid-cols-2 gap-4 text-xs mb-3">
                    <div>
                        <div class="font-bold text-blue-900 mb-1">Motivo (Tag 1):</div>
                        <div class="text-blue-700 bg-white border border-blue-100 px-2 py-1 rounded font-bold inline-block">${ticket.agent_tag1 || 'Não classificado'}</div>
                    </div>
                    <div>
                        <div class="font-bold text-blue-900 mb-1">Submotivo (Tag 2):</div>
                        <div class="text-blue-700 bg-white border border-blue-100 px-2 py-1 rounded font-bold inline-block">${ticket.agent_tag2 || 'Não classificado'}</div>
                    </div>
                </div>
                <div class="text-xs">
                    <div class="font-bold text-blue-900 mb-1">Observações do Analista:</div>
                    <div class="text-blue-800 italic bg-white/60 border border-blue-100 p-3 rounded-lg">${ticket.agent_notes || 'Nenhuma observação registrada.'}</div>
                </div>
            </div>
            <div class="h-px bg-slate-200 mb-4"></div>
            `;
            
            html += msgs.map(m => this.formatMonitorMsg(m.content, m.sender_type, m.created_at, m.file_url, m.file_name, m.file_type)).join(''); 
            
            content.innerHTML = html;
            content.scrollTop = content.scrollHeight;
            
            if (this.monitorSub) this.monitorSub.unsubscribe();
            
            this.monitorSub = agentAPI.subscribeToAllMessages(ticketId, (msgText, senderType, createdAt, fUrl, fName, fType) => { 
                content.innerHTML += this.formatMonitorMsg(msgText, senderType, createdAt, fUrl, fName, fType); 
                content.scrollTop = content.scrollHeight; 
            });
        } catch(e) { 
            content.innerHTML = '<div class="text-center text-red-400 font-bold mt-4">Erro de conexão.</div>'; 
        }
    },

    formatMonitorMsg(text, type, createdAt, fileUrl = null, fileName = null, fileType = null) {
        const isAgent = type === 'agent'; 
        const timeStr = createdAt ? new Date(createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''; 
        const mediaHtml = this.buildMediaHtml(fileUrl, fileName, fileType);
        
        return `
        <div class="flex flex-col ${isAgent ? 'items-end' : 'items-start'} w-full mb-4">
            <div class="text-[9px] text-slate-400 font-bold mb-1 px-1">${isAgent ? 'Analista' : 'Cliente'} • ${timeStr}</div>
            <div class="max-w-[85%] p-3 rounded-xl text-xs font-medium shadow-sm whitespace-pre-wrap ${isAgent ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-white border border-slate-200 text-slate-800 rounded-tl-none'}">
                ${text}${mediaHtml}
            </div>
        </div>`;
    },

    buildMediaHtml(fileUrl, fileName, fileType) {
        if (!fileUrl) return '';
        if (fileType && fileType.startsWith('image/')) {
            return `<div class="mt-2"><a href="${fileUrl}" target="_blank"><img src="${fileUrl}" class="max-w-[200px] h-auto rounded-lg border border-slate-300 hover:opacity-80 transition-opacity"></a></div>`;
        } else {
            return `<div class="mt-2"><a href="${fileUrl}" target="_blank" download class="flex items-center gap-2 bg-black/10 p-2.5 rounded-lg text-xs font-bold hover:bg-black/20 transition-colors cursor-pointer relative z-30 w-max max-w-full truncate"><span class="material-symbols-outlined text-sm shrink-0">download</span> <span class="truncate">${fileName || 'Arquivo anexado'}</span></a></div>`;
        }
    },

    closeMonitor() { 
        document.getElementById('modal-monitor').classList.add('hidden-view'); 
        if (this.monitorSub) { 
            this.monitorSub.unsubscribe(); 
            this.monitorSub = null; 
        } 
    },

    async pickTicket(id) {
        try {
            this.activeTicketId = id; 
            this.navigate('chat'); 
            document.getElementById('menu-chat').classList.remove('hidden-view'); 
            this.switchTab('crm-info');
            
            let t = await agentAPI.getTicketDetails(id); 
            this.currentTicket = t;
            
            if (t.status === 'open' || !t.agent_id) {
                const myCount = this.activeTickets.filter(tk => tk.status === 'in_progress' && tk.agent_id === this.currentUser.id).length;
                if (myCount >= 10) { 
                    alert("O limite de atendimentos simultâneos foi alcançado!"); 
                    this.navigate('queue'); 
                    return; 
                }
                await agentAPI.reassignTicket(id, this.currentUser.id); 
                t.status = 'in_progress'; 
                t.agent_id = this.currentUser.id; 
                await this.loadQueue(); 
            }

            this.renderBubbles(); 
            this.currentCustomer = t.customers; 

            document.getElementById('toggle-upload').checked = t.is_upload_enabled || false; 
            this.updateUploadToggleUI(t.is_upload_enabled || false);

            document.getElementById('chat-header-name').innerText = t.customers?.full_name || 'Desconhecido'; 
            document.getElementById('chat-header-protocol').innerText = `HZ-${t.protocol_number}`; 
            
            const isEmail = t.channel === 'email';
            document.getElementById('chat-header-channel').innerHTML = isEmail 
                ? `<span class="material-symbols-outlined text-[14px]">mail</span> E-MAIL` 
                : `<span class="material-symbols-outlined text-[14px]">forum</span> CHAT WEB`; 
            
            document.getElementById('chat-header-subject').innerText = `• ${t.ticket_subjects?.label || 'Sem assunto'}`;
            
            document.getElementById('crm-name').innerText = t.customers?.full_name || 'Desconhecido'; 
            document.getElementById('crm-email').innerText = t.customers?.email || 'Sem e-mail'; 
            
            document.getElementById('crm-customer-tag').innerText = t.ticket_subjects?.label || 'Sem assunto';
            this.allSubjects = await agentAPI.getAllSubjects();
            this.allSubsubjects = await agentAPI.getAllSubsubjects();
            
            const tag1Select = document.getElementById('crm-tag1');
            tag1Select.innerHTML = '<option value="">Selecione o Motivo Principal...</option>' + this.allSubjects.map(s => `<option value="${s.label}">${s.label}</option>`).join('');
            document.getElementById('crm-tag2').innerHTML = '<option value="">Selecione o Submotivo...</option>';
            document.getElementById('crm-notes').value = t.agent_notes || '';

            this.activeAgents = await agentAPI.getActiveAgents(); 
            this.populateTransferDropdowns();
            
            if (t.customers?.email) this.loadCustomerHistory(t.customers.email); 
            if (t.customer_id) this.loadCustomerOrders(t.customer_id);

            const msgs = await agentAPI.getMessages(id);
            if (this.messageSub) this.messageSub.unsubscribe();

            if (isEmail) {
                document.getElementById('chat-mode-container').classList.add('hidden-view'); 
                document.getElementById('email-mode-container').classList.remove('hidden-view');
                this.renderEmailThread(t, msgs);
            } else {
                document.getElementById('email-mode-container').classList.add('hidden-view'); 
                document.getElementById('chat-mode-container').classList.remove('hidden-view');
                document.getElementById('chat-history').innerHTML = '';
                
                msgs.forEach(m => this.renderMsg(m.content, m.sender_type, m.file_url, m.file_name, m.file_type));

                this.messageSub = agentAPI.subscribeToMessages(id, (msg, fUrl, fName, fType) => {
                    this.renderMsg(msg, 'customer', fUrl, fName, fType);
                    const tkIndex = this.activeTickets.findIndex(tk => tk.id === id);
                    if (tkIndex > -1) { 
                        this.activeTickets[tkIndex].last_sender = 'customer'; 
                        this.activeTickets[tkIndex].last_interaction_at = new Date().toISOString(); 
                        this.renderBubbles(); 
                    }
                });
            }
        } catch (e) { 
            alert("Erro ao carregar os dados do chat: " + e.message); 
        }
    },

    filterTag2() {
        const tag1Label = document.getElementById('crm-tag1').value;
        const tag2Select = document.getElementById('crm-tag2');
        tag2Select.innerHTML = '<option value="">Selecione o Submotivo...</option>';
        if (!tag1Label) return;
        
        const parentSubject = this.allSubjects.find(s => s.label === tag1Label);
        if (parentSubject) {
            const subs = this.allSubsubjects.filter(ss => ss.subject_id === parentSubject.id);
            tag2Select.innerHTML += subs.map(ss => `<option value="${ss.label}">${ss.label}</option>`).join('');
        }
    },

    renderEmailThread(ticket, msgs) {
        const area = document.getElementById('email-thread'); 
        if (!area) return; 
        
        let html = '';
        
        if (msgs.length > 0) {
            const firstMsg = msgs[0]; 
            const dateStr = new Date(firstMsg.created_at).toLocaleString('pt-BR');
            html += `
            <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm relative z-30">
                <div class="flex justify-between items-start border-b border-slate-100 pb-4 mb-4">
                    <div>
                        <div class="font-black text-slate-900 text-lg">${ticket.customers?.full_name || 'Cliente'}</div>
                        <div class="text-sm font-bold text-slate-500">&lt;${ticket.customers?.email || 'Sem e-mail'}&gt;</div>
                    </div>
                    <div class="text-xs font-bold text-slate-400">${dateStr}</div>
                </div>
                <div class="text-sm text-slate-800 whitespace-pre-wrap font-medium leading-relaxed">${firstMsg.content}</div>
                ${this.buildMediaHtml(firstMsg.file_url, firstMsg.file_name, firstMsg.file_type)}
            </div>`;
        }
        
        if (msgs.length > 1) {
            html += `<div class="flex items-center gap-4 my-6"><div class="h-px bg-slate-200 flex-1"></div><span class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Histórico da Thread</span><div class="h-px bg-slate-200 flex-1"></div></div>`;
            for (let i = 1; i < msgs.length; i++) {
                const m = msgs[i]; 
                const isAgent = m.sender_type === 'agent'; 
                const dateStr = new Date(m.created_at).toLocaleString('pt-BR'); 
                const senderName = isAgent ? 'Nossa Equipe (Analista)' : (ticket.customers?.full_name || 'Cliente'); 
                const bgColor = isAgent ? 'bg-blue-50 border-blue-100' : 'bg-white border-slate-200';
                
                html += `
                <div class="p-5 rounded-2xl border ${bgColor} shadow-sm relative z-30 mb-4 ${isAgent ? 'ml-12' : 'mr-12'}">
                    <div class="flex justify-between items-center mb-3 border-b ${isAgent ? 'border-blue-100' : 'border-slate-100'} pb-2">
                        <span class="text-xs font-black ${isAgent ? 'text-blue-700' : 'text-slate-700'}">${senderName}</span>
                        <span class="text-[10px] font-bold text-slate-400">${dateStr}</span>
                    </div>
                    <div class="text-sm text-slate-700 whitespace-pre-wrap">${m.content}</div>
                    ${this.buildMediaHtml(m.file_url, m.file_name, m.file_type)}
                </div>`;
            }
        }
        area.innerHTML = html; 
        area.scrollTop = area.scrollHeight;
    },

    renderMsg(text, type, fileUrl = null, fileName = null, fileType = null) {
        const isAgent = type === 'agent'; 
        const mediaHtml = this.buildMediaHtml(fileUrl, fileName, fileType);
        const area = document.getElementById('chat-history'); 
        if(!area) return;
        
        area.innerHTML += `
        <div class="flex ${isAgent ? 'justify-end' : 'justify-start'} w-full">
            <div class="max-w-[80%] p-4 rounded-2xl text-sm font-medium shadow-sm ${isAgent ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-white text-slate-800 rounded-tl-none border border-slate-100 whitespace-pre-wrap'} relative z-30">
                ${text}${mediaHtml}
            </div>
        </div>`;
        area.scrollTop = area.scrollHeight;
    },

    async closeTicket() {
        const tag1 = document.getElementById('crm-tag1').value;
        const tag2 = document.getElementById('crm-tag2').value;
        const notes = document.getElementById('crm-notes').value.trim();

        if (!tag1 || !tag2 || !notes) {
            alert("Para encerrar o atendimento, é obrigatório preencher o Motivo, o Submotivo e as Observações.");
            return;
        }

        if (!confirm("Tem certeza que deseja encerrar o atendimento atual?")) return;
        try { 
            await agentAPI.closeTicket(this.activeTicketId, tag1, tag2, notes); 
            this.activeTicketId = null; 
            document.getElementById('menu-chat').classList.add('hidden-view'); 
            this.navigate('queue'); 
            Orchestrator.findAndClaimNext(); 
        } catch (error) { 
            alert("Erro ao tentar fechar o ticket."); 
        }
    },

    switchTab(tabId) { 
        ['info', 'history', 'orders'].forEach(t => { 
            document.getElementById(`view-crm-${t}`).classList.add('hidden-view'); 
            document.getElementById(`tab-${t}`).classList.remove('border-blue-600', 'text-blue-600'); 
        }); 
        document.getElementById(`view-crm-${tabId.replace('crm-', '')}`).classList.remove('hidden-view'); 
        document.getElementById(tabId.replace('crm-', 'tab-')).classList.add('border-blue-600', 'text-blue-600'); 
    },
    
    populateTransferDropdowns() {
        const subSelect = document.getElementById('transfer-subject'); 
        subSelect.innerHTML = '<option value="">➜ Para Fila (Assunto)...</option>'; 
        this.allSubjects.forEach(s => subSelect.innerHTML += `<option value="${s.id}">${s.label}</option>`);
        
        const agSelect = document.getElementById('transfer-agent'); 
        agSelect.innerHTML = '<option value="">➜ Para Agente...</option>'; 
        this.activeAgents.forEach(a => { 
            if (a.id !== this.currentUser.id) {
                agSelect.innerHTML += `<option value="${a.id}">${a.full_name}</option>`;
            } 
        });
    },

    async transferTicket() {
        const newSub = document.getElementById('transfer-subject').value; 
        const newAg = document.getElementById('transfer-agent').value;
        const notes = document.getElementById('crm-notes').value.trim();

        if (!newSub && !newAg) return;
        
        if (confirm("Você quer mesmo transferir este chamado para outra pessoa/fila?")) { 
            try { 
                await agentAPI.transferTicket(this.activeTicketId, newSub, newAg, notes); 
                this.activeTicketId = null; 
                document.getElementById('menu-chat').classList.add('hidden-view'); 
                this.navigate('queue'); 
                Orchestrator.findAndClaimNext(); 
            } catch (e) { 
                alert("Erro na transferência."); 
            } 
        }
    },

    async loadCustomerHistory(email) {
        try {
            const hist = await agentAPI.getCustomerHistoryByEmail(email); 
            const container = document.getElementById('history-list');
            if(hist.length === 0) { 
                container.innerHTML = '<div class="text-xs text-slate-400 font-bold">Nenhum atendimento anterior.</div>'; 
                return; 
            }
            
            container.innerHTML = hist.map(h => {
                const tagsHtml = h.agent_tag1 ? `<div class="mt-2 text-[10px]"><span class="bg-blue-100 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded font-bold">${h.agent_tag1}</span> <span class="bg-slate-100 text-slate-600 border border-slate-200 px-1.5 py-0.5 rounded font-bold">${h.agent_tag2 || ''}</span></div><div class="text-[10px] text-slate-500 mt-1 italic bg-slate-50 p-1.5 rounded">"${h.agent_notes || ''}"</div>` : '';

                return `
                <div class="p-3 bg-white border border-slate-200 rounded-xl flex justify-between items-start transition-all hover:border-blue-300 relative z-20">
                    <div class="flex-1">
                        <div class="flex justify-between items-center w-full">
                            <div class="text-[10px] font-black text-blue-600">HZ-${h.protocol_number}</div>
                            <div class="text-[9px] font-bold text-slate-400">${new Date(h.created_at).toLocaleDateString()}</div>
                        </div>
                        <div class="text-[11px] font-bold text-slate-700 mt-1 truncate max-w-[200px]">Original: ${h.ticket_subjects?.label || 'Sem Assunto'}</div>
                        ${tagsHtml}
                    </div>
                    <button onclick="agentApp.viewPastChat('${h.id}', '${h.protocol_number}')" title="Ver Conversa Completa" class="ml-2 w-8 h-8 flex shrink-0 items-center justify-center bg-slate-50 border border-slate-200 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600 hover:border-blue-200 shadow-sm transition-all">
                        <span class="material-symbols-outlined text-sm">visibility</span>
                    </button>
                </div>`
            }).join('');
        } catch (e) { console.error(e); }
    },

    // AQUI ESTÁ O MODAL DE HISTÓRICO COM AS TAGS E NOTAS
    async viewPastChat(ticketId, protocolNumber) {
        try {
            const ticket = await agentAPI.getTicketDetails(ticketId); 
            const msgs = await agentAPI.getMessages(ticketId); 
            const modal = document.getElementById('modal-history'); 
            const content = document.getElementById('history-chat-content');
            
            document.getElementById('modal-history-protocol').innerText = `Protocolo HZ-${protocolNumber}`; 
            modal.classList.remove('hidden-view');
            
            let html = `
            <div class="bg-blue-50 border border-blue-100 p-4 rounded-xl mb-6 relative z-20">
                <h4 class="text-[10px] font-black text-blue-800 uppercase tracking-widest mb-3 flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">summarize</span> Resumo do Atendimento</h4>
                <div class="grid grid-cols-2 gap-4 text-xs mb-3">
                    <div>
                        <div class="font-bold text-blue-900 mb-1">Motivo (Tag 1):</div>
                        <div class="text-blue-700 bg-white border border-blue-100 px-2 py-1 rounded font-bold inline-block">${ticket.agent_tag1 || 'Não classificado'}</div>
                    </div>
                    <div>
                        <div class="font-bold text-blue-900 mb-1">Submotivo (Tag 2):</div>
                        <div class="text-blue-700 bg-white border border-blue-100 px-2 py-1 rounded font-bold inline-block">${ticket.agent_tag2 || 'Não classificado'}</div>
                    </div>
                </div>
                <div class="text-xs">
                    <div class="font-bold text-blue-900 mb-1">Observações do Analista:</div>
                    <div class="text-blue-800 italic bg-white/60 border border-blue-100 p-3 rounded-lg">${ticket.agent_notes || 'Nenhuma observação registrada.'}</div>
                </div>
            </div>
            <div class="h-px bg-slate-200 mb-4"></div>
            `;
            
            if(msgs.length === 0) { 
                html += '<div class="text-center text-slate-400 font-bold">Não existem mensagens registradas neste protocolo.</div>'; 
            } else {
                html += msgs.map(m => `
                <div class="flex ${m.sender_type === 'agent' ? 'justify-end' : 'justify-start'} w-full mb-4">
                    <div class="max-w-[85%] p-3 rounded-xl text-xs font-medium shadow-sm whitespace-pre-wrap ${m.sender_type === 'agent' ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-white border border-slate-200 text-slate-800 rounded-tl-none'}">
                        ${m.content}
                    </div>
                </div>`).join('');
            }
            
            content.innerHTML = html;
        } catch (e) { 
            console.error(e);
            alert("Erro ao tentar abrir a conversa."); 
        }
    },

    showNewOrderForm() { 
        document.getElementById('order-form').classList.toggle('hidden-view'); 
    },

    async saveOrder() {
        const product = document.getElementById('order-product').value; 
        const qty = document.getElementById('order-qty').value; 
        const amount = document.getElementById('order-amount').value;
        if(!product || !amount) return alert("Por favor, preencha o Nome do Produto e o Valor.");
        
        try { 
            await agentAPI.createOrder({ customer_id: this.currentCustomer.id, product_name: product, quantity: parseInt(qty), amount: parseFloat(amount.replace(',', '.')) }); 
            document.getElementById('order-product').value = ''; 
            document.getElementById('order-amount').value = ''; 
            document.getElementById('order-form').classList.add('hidden-view'); 
            this.loadCustomerOrders(this.currentCustomer.id); 
        } catch (e) { 
            alert("Erro ao tentar salvar o pedido."); 
        }
    },

    async loadCustomerOrders(customerId) {
        try {
            const orders = await agentAPI.getCustomerOrders(customerId); 
            const container = document.getElementById('order-list');
            if(orders.length === 0) { 
                container.innerHTML = '<div class="text-xs text-slate-400 font-bold">O cliente não possui nenhum pedido registrado.</div>'; 
                return; 
            }
            
            container.innerHTML = orders.map(o => `
            <div class="p-3 bg-white border border-dashed border-slate-300 rounded-xl flex justify-between items-center hover:bg-slate-50 transition-colors relative z-20">
                <div>
                    <div class="text-xs font-black text-slate-800">${o.product_name}</div>
                    <div class="text-[10px] font-bold text-slate-500">${o.quantity} unidade(s) • R$ ${o.amount.toFixed(2).replace('.', ',')}</div>
                </div>
                <div class="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-1 rounded">
                    ${new Date(o.created_at).toLocaleDateString()}
                </div>
            </div>`).join('');
        } catch (e) { console.error(e); }
    },

    // ==========================================
    // DASHBOARD & RELATÓRIOS (Atualizado com Data e Tabela)
    // ==========================================
    async renderDashboard() {
        try {
            const startDate = document.getElementById('dash-start').value;
            const endDate = document.getElementById('dash-end').value;
            
            const btnFiltro = event?.target?.closest('button');
            if (btnFiltro) btnFiltro.innerHTML = `<span class="material-symbols-outlined animate-spin text-[14px]">refresh</span> Buscando...`;

            // Busca os dados filtrados por data
            this.dashboardTickets = await agentAPI.getDashboardTickets(startDate, endDate); 
            this.allProfiles = await agentAPI.getTeamProfiles();
            
            const { data: orders } = await supabase.from('orders').select('amount'); 
            
            const tickets = this.dashboardTickets;
            const total = tickets.length; 
            const open = tickets.filter(t => t.status === 'open' || t.status === 'in_progress').length; 
            const closedTickets = tickets.filter(t => t.status === 'closed');
            const closed = closedTickets.length;
            
            const npsTickets = closedTickets.filter(t => t.rating !== null); 
            const avgNps = npsTickets.length > 0 ? (npsTickets.reduce((acc, t) => acc + t.rating, 0) / npsTickets.length).toFixed(1) : "0.0"; 
            const totalSales = orders.reduce((acc, o) => acc + parseFloat(o.amount), 0); // Vendas poderia filtrar data também, mas mantive geral por enquanto.
            
            document.getElementById('stat-total').innerText = total; 
            document.getElementById('stat-open').innerText = open; 
            document.getElementById('stat-nps').innerText = avgNps; 
            document.getElementById('stat-sales').innerText = `R$ ${totalSales.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
            
            this.updateStatusChart(open, closed); 
            this.updateAnalystRanking(closedTickets, this.allProfiles);
            this.renderClosedCasesTable(this.dashboardTickets, this.allProfiles);

            if (btnFiltro) btnFiltro.innerHTML = `<span class="material-symbols-outlined text-[14px]">filter_alt</span> Filtrar`;
        } catch (error) { console.error("Erro no Dashboard Executivo:", error); }
    },

    updateStatusChart(open, closed) {
        const ctx = document.getElementById('chartStatus').getContext('2d'); 
        if (window.myChart) window.myChart.destroy();
        
        window.myChart = new Chart(ctx, { 
            type: 'doughnut', 
            data: { 
                labels: ['Em Aberto/Curso', 'Finalizados'], 
                datasets: [{ 
                    data: [open, closed], 
                    backgroundColor: ['#3b82f6', '#10b981'], 
                    borderWidth: 0, 
                    hoverOffset: 4 
                }] 
            }, 
            options: { 
                responsive: true, 
                maintainAspectRatio: false, 
                cutout: '75%', 
                plugins: { 
                    legend: { position: 'bottom', labels: { padding: 20, font: { family: 'Manrope', weight: 'bold' } } } 
                } 
            } 
        });
    },

    updateAnalystRanking(closedTickets, profiles) {
        const container = document.getElementById('analyst-ranking');
        const ranking = profiles.map(p => { 
            const agentTickets = closedTickets.filter(t => t.agent_id === p.id && t.rating !== null); 
            const avg = agentTickets.length > 0 ? (agentTickets.reduce((acc, t) => acc + t.rating, 0) / agentTickets.length).toFixed(1) : 0; 
            return { id: p.id, name: p.full_name, avg: parseFloat(avg) }; 
        }).sort((a, b) => b.avg - a.avg).filter(r => r.avg > 0);
        
        if (ranking.length === 0) { 
            container.innerHTML = `<div class="text-sm text-slate-400 font-bold text-center py-4">Sem dados de NPS para ranquear no período.</div>`; 
            return; 
        }
        
        container.innerHTML = ranking.map((r, index) => { 
            const badgeColor = index === 0 ? 'bg-amber-100 text-amber-600 border-amber-200' : 'bg-slate-100 text-slate-600 border-slate-200'; 
            const isSelected = this.dashFilterAgent === r.id;
            return `
            <div onclick="agentApp.filterDashboardByAgent('${r.id}', '${r.name}')" class="cursor-pointer flex items-center justify-between p-4 bg-slate-50 border ${isSelected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-100'} rounded-2xl transition-all hover:bg-blue-50 relative z-20">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-full flex items-center justify-center font-black text-xs ${badgeColor} border">${index + 1}º</div>
                    <span class="font-bold text-slate-700">${r.name}</span>
                </div>
                <span class="px-3 py-1 bg-white border rounded-full font-black text-sm ${r.avg > 0 ? 'text-blue-600' : 'text-slate-400'} shadow-sm">${r.avg > 0 ? r.avg.toFixed(1) : '-'}</span>
            </div>`; 
        }).join('');
    },

    filterDashboardByAgent(agentId, agentName) {
        if (this.dashFilterAgent === agentId || !agentId) {
            this.dashFilterAgent = null; // Remove filtro se clicar no mesmo
            document.getElementById('active-filter-badge').classList.add('hidden-view');
        } else {
            this.dashFilterAgent = agentId;
            document.getElementById('active-filter-badge').classList.remove('hidden-view');
            document.getElementById('active-filter-name').innerText = agentName;
        }
        // Atualiza apenas a tabela e o ranking (visualmente)
        this.updateAnalystRanking(this.dashboardTickets.filter(t => t.status === 'closed'), this.allProfiles);
        this.renderClosedCasesTable(this.dashboardTickets, this.allProfiles);
    },

    renderClosedCasesTable(tickets, profiles) {
        const container = document.getElementById('closed-cases-tbody');
        const closedTickets = tickets.filter(t => t.status === 'closed');
        
        const filteredTickets = closedTickets.filter(t => {
            if (this.dashFilterAgent) return t.agent_id === this.dashFilterAgent;
            return true;
        });

        if (filteredTickets.length === 0) {
            container.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-slate-400 font-medium">Nenhum caso fechado no período.</td></tr>`;
            return;
        }

        container.innerHTML = filteredTickets.map(t => {
            const agentName = profiles.find(p => p.id === t.agent_id)?.full_name || 'Sistema/Desconhecido';
            
            // Cálculo de Tempo (Do created_at até o closed_at)
            const created = new Date(t.created_at);
            const closed = new Date(t.closed_at);
            const diffMs = closed - created;
            const hrs = Math.floor(diffMs / 3600000);
            const mins = Math.floor((diffMs % 3600000) / 60000);
            let tempoStr = `${mins}m`;
            if (hrs > 0) tempoStr = `${hrs}h ${mins}m`;

            return `
            <tr class="hover:bg-slate-50 transition-colors">
                <td class="p-4 font-black text-slate-900 text-xs">HZ-${t.protocol_number}</td>
                <td class="p-4 text-xs">
                    <div class="font-bold text-slate-800 truncate max-w-[150px]">${t.customers?.full_name || 'Cliente'}</div>
                    <div class="text-[10px] text-slate-500 truncate max-w-[150px]">${t.ticket_subjects?.label || 'Sem Assunto Inicial'}</div>
                </td>
                <td class="p-4 text-xs">
                    <div class="font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded w-max mb-1 text-[10px] truncate max-w-[150px]" title="${t.agent_tag1}">${t.agent_tag1 || 'Não Tagueado'}</div>
                    <div class="font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded w-max text-[10px] truncate max-w-[150px]" title="${t.agent_tag2}">${t.agent_tag2 || 'Não Tagueado'}</div>
                </td>
                <td class="p-4 font-bold text-slate-700 text-xs">${agentName}</td>
                <td class="p-4 font-bold text-slate-600 text-xs">${tempoStr}</td>
                <td class="p-4 text-center text-xs font-black ${t.rating >= 9 ? 'text-green-600' : (t.rating >= 7 ? 'text-amber-500' : (t.rating ? 'text-red-500' : 'text-slate-300'))}">${t.rating || '-'}</td>
                <td class="p-4 text-right">
                    <button onclick="agentApp.viewPastChat('${t.id}', '${t.protocol_number}')" class="bg-slate-100 text-slate-500 p-2 rounded-lg hover:bg-blue-100 hover:text-blue-600 transition-colors" title="Ver Histórico Completo">
                        <span class="material-symbols-outlined text-[16px]">visibility</span>
                    </button>
                </td>
            </tr>`;
        }).join('');
    },

    exportCSV() {
        if (!this.dashboardTickets || this.dashboardTickets.length === 0) {
            alert("Não há dados para exportar no período selecionado.");
            return;
        }
        
        const BOM = "\uFEFF"; // Garante UTF-8 no Excel
        let csvContent = BOM + "Protocolo;Canal;Data Criacao;Data Fechamento;Tempo Total (Minutos);Cliente;Email Cliente;Motivo Original;Tag 1 (Motivo);Tag 2 (Submotivo);Observacoes (Agente);Agente;Nota NPS\n";
        
        this.dashboardTickets.filter(t => t.status === 'closed').forEach(t => {
            const agentName = this.allProfiles.find(p => p.id === t.agent_id)?.full_name || 'Desconhecido';
            const created = new Date(t.created_at);
            const closed = new Date(t.closed_at);
            const diffMins = Math.floor((closed - created) / 60000);
            
            // Limpa as aspas e quebras de linha para não quebrar o CSV
            const safeNotes = t.agent_notes ? t.agent_notes.replace(/"/g, '""').replace(/\n/g, ' ') : '';
            
            const row = [
                `HZ-${t.protocol_number}`,
                t.channel,
                created.toLocaleString('pt-BR'),
                closed.toLocaleString('pt-BR'),
                diffMins,
                t.customers?.full_name || '',
                t.customers?.email || '',
                t.ticket_subjects?.label || '',
                t.agent_tag1 || '',
                t.agent_tag2 || '',
                `"${safeNotes}"`,
                agentName,
                t.rating || ''
            ].join(';');
            
            csvContent += row + "\n";
        });

        // Dispara o download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `horizon_relatorio_fechados_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },

    // ==========================================
    // GESTÃO DE EQUIPE E CHAT INTERNO (GESTOR)
    // ==========================================
    async loadTeam() {
        const team = await agentAPI.getTeamProfiles(); 
        const logs = await agentAPI.getAgentLogsToday(); 
        const tbody = document.getElementById('team-tbody');
        
        tbody.innerHTML = team.map(member => {
            let onlineSecs = logs.filter(l => l.agent_id === member.id && l.status === 'online').reduce((sum, l) => sum + (l.duration_seconds || 0), 0);
            let pausaSecs = logs.filter(l => l.agent_id === member.id && l.status === 'pausa').reduce((sum, l) => sum + (l.duration_seconds || 0), 0);
            let backSecs = logs.filter(l => l.agent_id === member.id && l.status === 'backoffice').reduce((sum, l) => sum + (l.duration_seconds || 0), 0);
            
            if (member.status && member.status_updated_at) {
                const currentSecs = Math.floor((Date.now() - new Date(member.status_updated_at).getTime()) / 1000);
                if (member.status === 'online') onlineSecs += currentSecs; 
                if (member.status === 'pausa') pausaSecs += currentSecs; 
                if (member.status === 'backoffice') backSecs += currentSecs;
            }
            
            const fmtTime = (secs) => { const h = Math.floor(secs / 3600); const m = Math.floor((secs % 3600) / 60); return `${h}h ${m}m`; };
            
            let statusBadge = member.status === 'online' ? '<span class="bg-green-100 text-green-700 px-2 py-0.5 rounded font-bold text-[10px]">ONLINE</span>' : member.status === 'pausa' ? '<span class="bg-amber-100 text-amber-700 px-2 py-0.5 rounded font-bold text-[10px]">EM PAUSA</span>' : member.status === 'backoffice' ? '<span class="bg-purple-100 text-purple-700 px-2 py-0.5 rounded font-bold text-[10px]">BACKOFFICE</span>' : '<span class="bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-bold text-[10px]">OFFLINE</span>';
            const timeHtml = `<div class="mb-2">${statusBadge}</div><div class="text-[10px] text-slate-500 font-bold space-y-0.5"><div><span class="text-green-600">Online:</span> ${fmtTime(onlineSecs)}</div><div><span class="text-amber-600">Pausa:</span> ${fmtTime(pausaSecs)}</div><div><span class="text-purple-600">Backoffice:</span> ${fmtTime(backSecs)}</div></div>`;
            
            const agentTickets = this.activeTickets.filter(t => t.agent_id === member.id && t.status === 'in_progress');
            
            let chatAguardando = agentTickets.filter(t => t.channel === 'web' && t.last_sender !== 'agent').length;
            let chatBolha = agentTickets.filter(t => t.channel === 'web' && t.last_sender === 'agent').length;
            
            let emailAguardando = agentTickets.filter(t => t.channel === 'email' && t.last_sender !== 'agent').length;
            let emailBolha = agentTickets.filter(t => t.channel === 'email' && t.last_sender === 'agent').length;

            let ticketsBadge = '';
            if (member.can_web) ticketsBadge += `<div class="mt-2 bg-blue-50 text-blue-700 text-[10px] font-black px-2 py-1 rounded w-max border border-blue-100 flex items-center gap-1">CHAT: ${chatAguardando} ag. você | ${chatBolha} ag. cliente</div>`;
            if (member.can_email) ticketsBadge += `<div class="mt-1 bg-orange-50 text-orange-700 text-[10px] font-black px-2 py-1 rounded w-max border border-orange-100 flex items-center gap-1">E-MAIL: ${emailAguardando} ag. você | ${emailBolha} ag. cliente</div>`;

            let skillsHTML = '';
            if (member.is_approved) {
                let skillsBadges = '';
                let availableOptions = '<option value="" disabled selected>+ Adicionar Assunto...</option>';
                
                this.allSubjects.forEach(sub => {
                    const hasSkill = member.agent_skills.some(skill => skill.subject_id === sub.id);
                    if (hasSkill) {
                        skillsBadges += `<span class="bg-slate-100 border border-slate-200 text-slate-600 text-[10px] px-2 py-1 rounded flex items-center gap-1 font-bold">${sub.label} <button onclick="agentApp.toggleSkill('${member.id}', '${sub.id}', false)" class="hover:text-red-500 transition-colors"><span class="material-symbols-outlined text-[12px]">close</span></button></span>`;
                    } else {
                        availableOptions += `<option value="${sub.id}">${sub.label}</option>`;
                    }
                });

                skillsHTML = `
                <div class="flex flex-col gap-2">
                    <div class="flex gap-4 border-b pb-2 border-slate-100">
                        <label class="flex items-center gap-1 cursor-pointer"><input type="checkbox" ${member.can_web ? 'checked' : ''} onchange="agentApp.toggleChannel('${member.id}', 'web', this.checked)" class="w-3 h-3 text-blue-600"><span class="text-[10px] font-black text-slate-600">WEB (Chat)</span></label>
                        <label class="flex items-center gap-1 cursor-pointer"><input type="checkbox" ${member.can_email ? 'checked' : ''} onchange="agentApp.toggleChannel('${member.id}', 'email', this.checked)" class="w-3 h-3 text-blue-600"><span class="text-[10px] font-black text-slate-600">E-MAIL</span></label>
                    </div>
                    <div class="mt-2 flex gap-3 border-b border-slate-100 pb-2">
                        <label class="text-[9px] font-bold text-slate-500 flex flex-col">Max Chats <input type="number" min="1" value="${member.max_chats || 3}" onchange="agentApp.updateAgentLimits('${member.id}', this.value, null)" class="border rounded px-1.5 py-0.5 mt-0.5 w-14 text-center"></label>
                        <label class="text-[9px] font-bold text-slate-500 flex flex-col">Max E-mails <input type="number" min="1" value="${member.max_emails || 5}" onchange="agentApp.updateAgentLimits('${member.id}', null, this.value)" class="border rounded px-1.5 py-0.5 mt-0.5 w-14 text-center"></label>
                    </div>
                    <div class="flex flex-wrap gap-1 min-h-[24px]">
                        ${skillsBadges || '<span class="text-[10px] text-slate-400 font-bold italic">Nenhum assunto</span>'}
                    </div>
                    <select onchange="if(this.value) { agentApp.toggleSkill('${member.id}', this.value, true); this.value=''; }" class="bg-slate-50 border border-slate-200 text-slate-600 text-[10px] font-bold rounded p-1.5 outline-none w-full cursor-pointer hover:bg-slate-100 transition-colors">
                        ${availableOptions}
                    </select>
                </div>`;
            }

            const selStatus = `
            <select onchange="agentApp.forceAgentStatus('${member.id}', this.value)" class="text-[10px] font-bold bg-slate-50 border border-slate-200 text-slate-600 rounded p-1 outline-none w-full relative z-30 mb-2">
                <option value="online" ${member.status === 'online' ? 'selected' : ''}>Forçar Online</option>
                <option value="pausa" ${member.status === 'pausa' ? 'selected' : ''}>Forçar Pausa</option>
                <option value="backoffice" ${member.status === 'backoffice' ? 'selected' : ''}>Forçar Backoffice</option>
                <option value="offline" ${member.status === 'offline' ? 'selected' : ''}>Forçar Offline</option>
            </select>`;
            
            const chatBtn = member.id !== this.currentUser.id 
                ? `<button onclick="agentApp.openInternalChat('${member.id}', '${member.full_name}')" class="bg-slate-800 text-white px-3 py-1.5 rounded-lg text-[10px] font-black hover:bg-slate-700 transition-all flex items-center justify-center w-full gap-1"><span class="material-symbols-outlined text-[12px]">forum</span> Falar c/ Agente</button>` 
                : '';

            return `
            <tr class="relative z-20 hover:bg-slate-50 transition-colors">
                <td class="p-5 font-black text-slate-900">${member.full_name}<div class="text-[10px] font-bold text-slate-400 mt-1 uppercase">${member.role}</div>${ticketsBadge}</td>
                <td class="p-5">${timeHtml}</td>
                <td class="p-5 w-[250px]">${skillsHTML}</td>
                <td class="p-5 text-right w-36">${!member.is_approved ? `<button onclick="agentApp.approveMember('${member.id}')" class="bg-blue-600 text-white px-4 py-2 rounded font-bold text-xs mb-2">Aprovar</button>` : selStatus}${chatBtn}</td>
            </tr>`;
        }).join('');
    },

    async openInternalChat(targetId = null, targetName = null) {
        if (targetId) {
            this.internalChatTarget = targetId;
            document.getElementById('internal-chat-target-name').innerText = targetName;
        }
        
        document.getElementById('btn-internal-alert').classList.add('hidden-view');
        document.getElementById('modal-internal-chat').classList.remove('hidden-view');
        
        const content = document.getElementById('internal-chat-content');
        content.innerHTML = '<div class="text-center text-slate-400 text-xs font-bold">Carregando o histórico...</div>';
        
        try {
            if (!this.internalChatTarget) throw new Error("ID do usuário alvo não fornecido.");
            const msgs = await agentAPI.getInternalMessages(this.currentUser.id, this.internalChatTarget);
            content.innerHTML = '';
            msgs.forEach(m => this.renderInternalMsg(m, m.sender_id === this.currentUser.id));
        } catch(e) { 
            console.error("Erro Chat Interno:", e);
            content.innerHTML = `<div class="text-center text-red-400 text-xs font-bold">Falha ao abrir a conversa.</div>`; 
        }
    },

    closeInternalChat() {
        document.getElementById('modal-internal-chat').classList.add('hidden-view');
    },

    renderInternalMsg(msg, isMe) {
        const content = document.getElementById('internal-chat-content');
        const timeStr = msg.created_at ? new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
        content.innerHTML += `
        <div class="flex ${isMe ? 'justify-end' : 'justify-start'} w-full">
            <div class="max-w-[85%] p-2 rounded-xl text-xs font-medium shadow-sm ${isMe ? 'bg-slate-800 text-white rounded-tr-none' : 'bg-white border text-slate-800 rounded-tl-none'}">
                <div class="whitespace-pre-wrap">${msg.content}</div>
                <div class="text-[8px] text-right mt-1 opacity-60 font-bold">${timeStr}</div>
            </div>
        </div>`;
        content.scrollTop = content.scrollHeight;
    },

    async approveMember(id) { 
        if(confirm("Deseja realmente aprovar este analista?")) { 
            await agentAPI.approveUser(id, 'analista'); 
            this.loadTeam(); 
        } 
    },
    
    async toggleChannel(agentId, channel, isEnabled) { 
        try { 
            await agentAPI.toggleChannel(agentId, channel, isEnabled);
            if (!isEnabled) {
                await agentAPI.releaseTicketsByChannel(agentId, channel);
            }
            this.loadTeam(); 
        } catch (e) { 
            console.error("Erro toggleChannel", e);
            this.loadTeam(); 
        } 
    },
    
    async toggleSkill(agentId, subjectId, isAdding) { 
        try { 
            await agentAPI.toggleAgentSkill(agentId, subjectId, isAdding); 
            this.loadTeam(); 
        } catch (e) { 
            console.error("Erro toggleSkill", e);
            this.loadTeam(); 
        } 
    }
};

App.init();