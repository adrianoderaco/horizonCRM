// Arquivo: js/agent/app.js
import { agentAPI } from './api.js';
import { supabase } from '../supabase.js';
import { Orchestrator } from './orchestrator.js';
import { Sidebar } from './sidebar.js';

const App = {
    activeTicketId: null,
    messageSub: null,
    monitorSub: null, // Novo: Guarda a assinatura do modal de monitoria
    isRegisterMode: false,
    currentUser: null,
    currentCustomer: null,
    allSubjects: [],
    activeAgents: [],
    timerInterval: null,
    activeTickets: [],

    init() {
        window.agentApp = this; 
        this.startLiveTimers(); 

        window.addEventListener('ticket-assigned', (e) => this.pickTicket(e.detail.id));

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
                } catch (err) { alert("Erro: " + err.message); } 
                finally { btn.innerHTML = originalText; }
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
                this.activeAgents = await agentAPI.getActiveAgents();
                
                Sidebar.render('sidebar-root', profile.role);
                
                if (profile.role === 'gestor') {
                    document.getElementById('wrapper-routing').classList.remove('hidden-view');
                }
                
                document.getElementById('toggle-routing').checked = profile.is_routing_active;
                Orchestrator.init(profile.id, profile.is_routing_active);

                this.loadQueue();
                agentAPI.subscribeToQueue(() => {
                    this.loadQueue();
                    if (document.getElementById('sec-dashboard') && !document.getElementById('sec-dashboard').classList.contains('hidden-view')) {
                        this.renderDashboard();
                    }
                });

            } catch (error) { alert("Erro no login."); btn.innerHTML = originalText; }
        });

        document.getElementById('agent-chat-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const input = document.getElementById('chat-input');
            const text = input.value.trim();
            if(!text || !this.activeTicketId) return;
            this.renderMsg(text, 'agent');
            input.value = '';
            await agentAPI.sendMessage(this.activeTicketId, text);
        });
    },

    async logout() {
        if(confirm("Deseja sair? Seus atendimentos em andamento voltarão automaticamente para a fila!")) {
            try {
                await agentAPI.releaseMyTickets(this.currentUser.id);
                await supabase.auth.signOut();
                location.reload();
            } catch(e) { alert("Erro ao deslogar."); }
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
                if (diffSeconds > 600) { el.classList.remove('text-slate-600'); el.classList.add('text-red-600'); }
            });

            document.querySelectorAll('.chat-bubble').forEach(el => {
                const lastSender = el.dataset.sender;
                const diffSeconds = Math.max(0, Math.floor((Date.now() - new Date(el.dataset.time).getTime()) / 1000));
                
                el.classList.remove('bg-blue-500', 'bg-green-500', 'bg-orange-500', 'bg-red-500', 'animate-pulse');

                if (lastSender === 'customer') {
                    el.classList.add('bg-blue-500', 'animate-pulse');
                } else {
                    if (diffSeconds < 300) el.classList.add('bg-green-500');      
                    else if (diffSeconds < 600) el.classList.add('bg-orange-500'); 
                    else el.classList.add('bg-red-500');                           
                }
            });
        }, 1000);
    },

    renderBubbles() {
        const container = document.getElementById('bubble-container');
        if(!container) return;
        const myTickets = this.activeTickets.filter(t => t.status === 'in_progress' && t.agent_id === this.currentUser.id);
        
        container.innerHTML = myTickets.map(t => `
            <div onclick="agentApp.pickTicket('${t.id}')" 
                 class="chat-bubble cursor-pointer text-white text-[10px] font-black w-10 h-10 rounded-full flex items-center justify-center shadow-md transition-all hover:scale-110 shrink-0 border-2 ${this.activeTicketId === t.id ? 'border-slate-800' : 'border-transparent'}"
                 data-sender="${t.last_sender || 'customer'}" 
                 data-time="${t.last_interaction_at || t.created_at}"
                 title="HZ-${t.protocol_number}">
                 ${t.protocol_number.slice(-3)}
            </div>
        `).join('');
    },

    toggleAuthMode() {
        this.isRegisterMode = !this.isRegisterMode;
        document.getElementById('auth-title').innerText = this.isRegisterMode ? "Solicitar Acesso" : "Acesso Restrito";
        document.getElementById('btn-login').innerHTML = this.isRegisterMode ? 'Criar Conta' : 'Entrar <span class="material-symbols-outlined">login</span>';
        const regName = document.getElementById('reg-name');
        if (this.isRegisterMode) { regName.classList.remove('hidden-view'); regName.required = true; } 
        else { regName.classList.add('hidden-view'); regName.required = false; }
    },

    navigate(target) {
        ['queue', 'chat', 'team', 'dashboard'].forEach(s => document.getElementById(`sec-${s}`)?.classList.add('hidden-view'));
        document.getElementById(`sec-${target}`).classList.remove('hidden-view');
        if (target === 'team') this.loadTeam();
        if (target === 'dashboard') this.renderDashboard();
    },

    async toggleRouting(isActive) {
        try {
            await agentAPI.updateRoutingStatus(this.currentUser.id, isActive);
            Orchestrator.setStatus(isActive); 
        } catch(e) { document.getElementById('toggle-routing').checked = !isActive; }
    },

    async loadQueue() {
        this.activeTickets = await agentAPI.getPendingTickets();
        const tbody = document.getElementById('queue-tbody');
        const countEl = document.getElementById('queue-count');
        const isGestor = this.currentUser.role === 'gestor';

        this.renderBubbles();

        const tickets = isGestor ? this.activeTickets : this.activeTickets.filter(t => t.status === 'open' || t.agent_id === this.currentUser.id);

        if(countEl) countEl.innerText = `${tickets.length} tickets ativos`;
        if (tickets.length === 0) { tbody.innerHTML = `<tr><td colspan="4" class="p-10 text-center text-slate-300 font-bold">Nenhum ticket pendente.</td></tr>`; return; }

        tbody.innerHTML = tickets.map(t => {
            const inProg = t.status === 'in_progress';
            const isMine = t.agent_id === this.currentUser.id;
            const agentName = t.agent_id ? (this.activeAgents.find(a => a.id === t.agent_id)?.full_name || 'Desconhecido') : 'Fila';

            let statusHtml = `
                <div class="flex flex-col gap-1 items-start">
                    ${inProg ? `<span class="bg-amber-100 text-amber-700 text-[10px] px-2 py-0.5 rounded font-bold">Em Atendimento</span>` : `<span class="bg-blue-100 text-blue-700 text-[10px] px-2 py-0.5 rounded font-bold">Aguardando Fila</span>`}
                    <span class="live-timer text-xs font-black font-mono text-slate-600" data-time="${t.created_at}">--:--:--</span>
                </div>
            `;

            let agentDisplay = `<span class="text-[11px] font-bold text-slate-500 block mt-1">Analista: ${agentName}</span>`;
            if (isGestor) {
                agentDisplay = `
                    <select onchange="agentApp.reassignTicket('${t.id}', this.value)" class="mt-1 text-[10px] font-bold bg-slate-50 border border-slate-200 text-slate-600 rounded p-1 outline-none w-full max-w-[150px]">
                        <option value="">Devolver para Fila</option>
                        ${this.activeAgents.map(a => `<option value="${a.id}" ${a.id === t.agent_id ? 'selected' : ''}>${a.full_name}</option>`).join('')}
                    </select>
                `;
            }

            let actionBtn = `<button onclick="agentApp.pickTicket('${t.id}')" class="bg-slate-900 text-white px-5 py-2.5 rounded-xl text-xs font-black hover:bg-blue-600 transition-all">${inProg && isMine ? 'Retomar Chat' : 'Atender'}</button>`;
            
            // NOVO: Se o Gestor está olhando a fila de outra pessoa, libera o botão de Monitorar
            if (inProg && !isMine && isGestor) {
                actionBtn = `<button onclick="agentApp.monitorTicket('${t.id}', '${t.protocol_number}')" class="bg-blue-100 text-blue-700 px-4 py-2.5 rounded-xl text-xs font-black hover:bg-blue-200 transition-all flex items-center gap-1 justify-center w-full"><span class="material-symbols-outlined text-[16px]">visibility</span> Monitorar</button>`;
            }

            return `
            <tr class="hover:bg-slate-50 transition-colors">
                <td class="p-5 font-black text-slate-900">HZ-${t.protocol_number} <span class="text-[10px] bg-slate-200 px-2 py-0.5 rounded ml-2">${t.channel}</span></td>
                <td class="p-5 font-black text-slate-900">${t.customers.full_name}<br><span class="text-[11px] font-bold text-slate-500">${t.ticket_subjects?.label || '---'}</span> ${agentDisplay}</td>
                <td class="p-5">${statusHtml}</td>
                <td class="p-5 text-right w-32">${actionBtn}</td>
            </tr>`;
        }).join('');
    },

    async reassignTicket(ticketId, newAgentId) {
        if(confirm("Deseja alterar o dono deste chamado?")) {
            await agentAPI.reassignTicket(ticketId, newAgentId);
        } else { this.loadQueue(); }
    },

    // --- MONITORIA AO VIVO (GESTOR) ---
    async monitorTicket(ticketId, protocolNumber) {
        const modal = document.getElementById('modal-monitor');
        const content = document.getElementById('monitor-chat-content');
        document.getElementById('modal-monitor-protocol').innerText = `Protocolo HZ-${protocolNumber}`;
        
        modal.classList.remove('hidden-view');
        content.innerHTML = '<div class="text-center text-slate-400 font-bold mt-4">Carregando conversa...</div>';

        try {
            // Carrega o histórico até agora
            const msgs = await agentAPI.getMessages(ticketId);
            content.innerHTML = msgs.map(m => this.formatMonitorMsg(m.content, m.sender_type)).join('');
            content.scrollTop = content.scrollHeight;

            // Fica escutando as novas mensagens em tempo real
            if (this.monitorSub) this.monitorSub.unsubscribe();
            this.monitorSub = agentAPI.subscribeToAllMessages(ticketId, (msgText, senderType) => {
                content.innerHTML += this.formatMonitorMsg(msgText, senderType);
                content.scrollTop = content.scrollHeight;
            });
        } catch(e) { content.innerHTML = '<div class="text-center text-red-400 font-bold mt-4">Erro ao carregar monitoria.</div>'; }
    },

    formatMonitorMsg(text, type) {
        const isAgent = type === 'agent';
        return `
            <div class="flex ${isAgent ? 'justify-end' : 'justify-start'} w-full">
                <div class="max-w-[85%] p-3 rounded-xl text-xs font-medium shadow-sm whitespace-pre-wrap ${isAgent ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-white border border-slate-200 text-slate-800 rounded-tl-none'}">${text}</div>
            </div>`;
    },

    closeMonitor() {
        document.getElementById('modal-monitor').classList.add('hidden-view');
        if (this.monitorSub) {
            this.monitorSub.unsubscribe();
            this.monitorSub = null;
        }
    },

    // --- ATENDIMENTO E CHAT ---
    async pickTicket(id) {
        this.activeTicketId = id;
        this.navigate('chat');
        document.getElementById('menu-chat').classList.remove('hidden-view');
        document.getElementById('chat-history').innerHTML = '';
        this.switchTab('crm-info');
        this.renderBubbles();

        let t = await agentAPI.getTicketDetails(id);
        
        if (t.status === 'open' || !t.agent_id) {
            const myCount = this.activeTickets.filter(tk => tk.status === 'in_progress' && tk.agent_id === this.currentUser.id).length;
            if (myCount >= 10) {
                alert("Você atingiu o limite de 10 atendimentos simultâneos!");
                this.navigate('queue');
                return;
            }
            await agentAPI.reassignTicket(id, this.currentUser.id);
            t.status = 'in_progress';
            t.agent_id = this.currentUser.id;
        }

        this.currentCustomer = t.customers; 
        
        document.getElementById('chat-header-name').innerText = t.customers.full_name;
        document.getElementById('chat-header-protocol').innerText = `HZ-${t.protocol_number}`;
        document.getElementById('crm-name').innerText = t.customers.full_name;
        document.getElementById('crm-email').innerText = t.customers.email;
        document.getElementById('crm-tag1').innerText = t.ticket_subjects?.label || 'Sem assunto';
        document.getElementById('crm-tag2').value = t.tag2_detail || '';

        this.populateTransferDropdowns();
        this.loadCustomerHistory(t.customer_id);
        this.loadCustomerOrders(t.customer_id);

        const msgs = await agentAPI.getMessages(id);
        msgs.forEach(m => this.renderMsg(m.content, m.sender_type));

        if (this.messageSub) this.messageSub.unsubscribe();
        this.messageSub = agentAPI.subscribeToMessages(id, (msg) => this.renderMsg(msg, 'customer'));
    },

    renderMsg(text, type) {
        const isAgent = type === 'agent';
        const area = document.getElementById('chat-history');
        area.innerHTML += `
            <div class="flex ${isAgent ? 'justify-end' : 'justify-start'} w-full">
                <div class="max-w-[80%] p-4 rounded-2xl text-sm font-medium shadow-sm ${isAgent ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-white text-slate-800 rounded-tl-none border border-slate-100 whitespace-pre-wrap'}">${text}</div>
            </div>`;
        area.scrollTop = area.scrollHeight;
    },

    async closeTicket() {
        if (!confirm("Encerrar este atendimento?")) return;
        try {
            await agentAPI.closeTicket(this.activeTicketId, document.getElementById('crm-tag2').value);
            this.activeTicketId = null;
            document.getElementById('menu-chat').classList.add('hidden-view');
            this.navigate('queue');
            Orchestrator.findAndClaimNext();
        } catch (error) { alert("Erro ao fechar."); }
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
        this.activeAgents.forEach(a => { if (a.id !== this.currentUser.id) agSelect.innerHTML += `<option value="${a.id}">${a.full_name}</option>`; });
    },

    async transferTicket() {
        const newSub = document.getElementById('transfer-subject').value;
        const newAg = document.getElementById('transfer-agent').value;
        if (!newSub && !newAg) return;
        if (confirm("Transferir chamado?")) {
            try {
                await agentAPI.transferTicket(this.activeTicketId, newSub, newAg, document.getElementById('crm-tag2').value);
                this.activeTicketId = null;
                document.getElementById('menu-chat').classList.add('hidden-view');
                this.navigate('queue');
                Orchestrator.findAndClaimNext();
            } catch (e) { alert("Erro na transferência."); }
        }
    },

    async loadCustomerHistory(customerId) {
        try {
            const hist = await agentAPI.getCustomerHistory(customerId);
            const container = document.getElementById('history-list');
            if(hist.length === 0) { container.innerHTML = '<div class="text-xs text-slate-400 font-bold">Nenhum atendimento anterior.</div>'; return; }
            
            container.innerHTML = hist.map(h => `
                <div class="p-3 bg-slate-50 border rounded-xl flex justify-between items-center transition-all hover:border-blue-300">
                    <div><div class="text-[10px] font-black text-slate-400">HZ-${h.protocol_number}</div><div class="text-xs font-bold text-slate-700 truncate max-w-[200px]">${h.ticket_subjects?.label || 'S/ Assunto'}</div><div class="text-[10px] text-slate-400">${new Date(h.created_at).toLocaleDateString()}</div></div>
                    <button onclick="agentApp.viewPastChat('${h.id}', '${h.protocol_number}')" title="Ver Conversa" class="w-8 h-8 flex items-center justify-center bg-white border rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600 shadow-sm transition-all"><span class="material-symbols-outlined text-sm">visibility</span></button>
                </div>
            `).join('');
        } catch (e) { console.error(e); }
    },

    async viewPastChat(ticketId, protocolNumber) {
        try {
            const msgs = await agentAPI.getMessages(ticketId);
            const modal = document.getElementById('modal-history');
            const content = document.getElementById('history-chat-content');
            document.getElementById('modal-history-protocol').innerText = `Protocolo HZ-${protocolNumber}`;
            
            modal.classList.remove('hidden-view');
            if(msgs.length === 0) { content.innerHTML = '<div class="text-center text-slate-400 font-bold">Sem mensagens registradas.</div>'; return; }
            
            content.innerHTML = msgs.map(m => `
                <div class="flex ${m.sender_type === 'agent' ? 'justify-end' : 'justify-start'} w-full">
                    <div class="max-w-[85%] p-3 rounded-xl text-xs font-medium shadow-sm whitespace-pre-wrap ${m.sender_type === 'agent' ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-white border border-slate-200 text-slate-800 rounded-tl-none'}">${m.content}</div>
                </div>
            `).join('');
        } catch (e) { alert("Erro ao carregar conversa."); }
    },

    showNewOrderForm() { document.getElementById('order-form').classList.toggle('hidden-view'); },

    async saveOrder() {
        const product = document.getElementById('order-product').value;
        const qty = document.getElementById('order-qty').value;
        const amount = document.getElementById('order-amount').value;
        if(!product || !amount) return alert("Preencha Produto e Valor.");
        try {
            await agentAPI.createOrder({ customer_id: this.currentCustomer.id, product_name: product, quantity: parseInt(qty), amount: parseFloat(amount.replace(',', '.')) });
            document.getElementById('order-product').value = ''; document.getElementById('order-amount').value = '';
            document.getElementById('order-form').classList.add('hidden-view');
            this.loadCustomerOrders(this.currentCustomer.id);
        } catch (e) { alert("Erro ao salvar pedido."); }
    },

    async loadCustomerOrders(customerId) {
        try {
            const orders = await agentAPI.getCustomerOrders(customerId);
            const container = document.getElementById('order-list');
            if(orders.length === 0) { container.innerHTML = '<div class="text-xs text-slate-400 font-bold">Nenhum pedido registrado.</div>'; return; }
            
            container.innerHTML = orders.map(o => `
                <div class="p-3 bg-white border border-dashed border-slate-300 rounded-xl flex justify-between items-center hover:bg-slate-50 transition-colors">
                    <div><div class="text-xs font-black text-slate-800">${o.product_name}</div><div class="text-[10px] font-bold text-slate-500">${o.quantity} un • R$ ${o.amount.toFixed(2).replace('.', ',')}</div></div>
                    <div class="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-1 rounded">${new Date(o.created_at).toLocaleDateString()}</div>
                </div>
            `).join('');
        } catch (e) { console.error(e); }
    },

    async renderDashboard() {
        try {
            const { data: tickets } = await supabase.from('tickets').select('status, rating, agent_id');
            const { data: orders } = await supabase.from('orders').select('amount');
            const { data: profiles } = await supabase.from('profiles').select('id, full_name');

            const total = tickets.length;
            const open = tickets.filter(t => t.status === 'open').length;
            const inProgress = tickets.filter(t => t.status === 'in_progress').length;
            const closed = tickets.filter(t => t.status === 'closed').length;
            
            const npsTickets = tickets.filter(t => t.rating !== null);
            const avgNps = npsTickets.length > 0 ? (npsTickets.reduce((acc, t) => acc + t.rating, 0) / npsTickets.length).toFixed(1) : "0.0";
            const totalSales = orders.reduce((acc, o) => acc + parseFloat(o.amount), 0);

            document.getElementById('stat-total').innerText = total;
            document.getElementById('stat-open').innerText = open;
            document.getElementById('stat-nps').innerText = avgNps;
            document.getElementById('stat-sales').innerText = `R$ ${totalSales.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

            this.updateStatusChart(open, inProgress, closed);
            this.updateAnalystRanking(tickets, profiles);
        } catch (error) { console.error("Erro Dashboard:", error); }
    },

    updateStatusChart(open, inProgress, closed) {
        const ctx = document.getElementById('chartStatus').getContext('2d');
        if (window.myChart) window.myChart.destroy();
        window.myChart = new Chart(ctx, {
            type: 'doughnut',
            data: { labels: ['Aberto', 'Em Curso', 'Finalizados'], datasets: [{ data: [open, inProgress, closed], backgroundColor: ['#3b82f6', '#f59e0b', '#10b981'], borderWidth: 0, hoverOffset: 4 }] },
            options: { responsive: true, maintainAspectRatio: false, cutout: '75%', plugins: { legend: { position: 'bottom', labels: { padding: 20, font: { family: 'Manrope', weight: 'bold' } } } } }
        });
    },

    updateAnalystRanking(tickets, profiles) {
        const container = document.getElementById('analyst-ranking');
        const ranking = profiles.map(p => {
            const agentTickets = tickets.filter(t => t.agent_id === p.id && t.rating !== null);
            const avg = agentTickets.length > 0 ? (agentTickets.reduce((acc, t) => acc + t.rating, 0) / agentTickets.length).toFixed(1) : 0;
            return { name: p.full_name, avg: parseFloat(avg) };
        }).sort((a, b) => b.avg - a.avg);

        if (ranking.length === 0) { container.innerHTML = `<div class="text-sm text-slate-400 font-bold text-center py-4">S/ Dados.</div>`; return; }

        container.innerHTML = ranking.map((r, index) => {
            const badgeColor = index === 0 ? 'bg-amber-100 text-amber-600 border-amber-200' : 'bg-slate-100 text-slate-600 border-slate-200';
            return `
            <div class="flex items-center justify-between p-4 bg-slate-50 border border-slate-100 rounded-2xl transition-all hover:bg-slate-100">
                <div class="flex items-center gap-3"><div class="w-8 h-8 rounded-full flex items-center justify-center font-black text-xs ${badgeColor} border">${index + 1}º</div><span class="font-bold text-slate-700">${r.name}</span></div>
                <span class="px-3 py-1 bg-white border rounded-full font-black text-sm ${r.avg > 0 ? 'text-blue-600' : 'text-slate-400'} shadow-sm">${r.avg > 0 ? r.avg.toFixed(1) : '-'}</span>
            </div>`;
        }).join('');
    },

    async loadTeam() {
        const team = await agentAPI.getTeamProfiles();
        const tbody = document.getElementById('team-tbody');
        tbody.innerHTML = team.map(member => {
            let skillsHTML = '';
            if (member.is_approved) {
                skillsHTML = `<div class="flex flex-col gap-1">`;
                this.allSubjects.forEach(sub => {
                    const hasSkill = member.agent_skills.some(skill => skill.subject_id === sub.id);
                    skillsHTML += `<label class="flex items-center gap-2 cursor-pointer w-fit"><input type="checkbox" ${hasSkill ? 'checked' : ''} onchange="agentApp.toggleSkill('${member.id}', '${sub.id}', this.checked)" class="w-4 h-4 text-blue-600"><span class="text-[10px] font-bold text-slate-600">${sub.label}</span></label>`;
                });
                skillsHTML += `</div>`;
            }
            return `<tr><td class="p-5 font-black text-slate-900">${member.full_name}</td><td class="p-5 text-xs font-bold uppercase text-slate-500">${member.role}</td><td class="p-5">${skillsHTML}</td><td class="p-5 text-right">${!member.is_approved ? `<button onclick="agentApp.approveMember('${member.id}')" class="bg-blue-600 text-white px-4 py-2 rounded font-bold text-xs">Aprovar</button>` : ''}</td></tr>`;
        }).join('');
    },

    async approveMember(id) { if(confirm("Aprovar?")) { await agentAPI.approveUser(id, 'analista'); this.loadTeam(); } },
    async toggleSkill(agentId, subjectId, isAdding) { try { await agentAPI.toggleAgentSkill(agentId, subjectId, isAdding); } catch (e) { this.loadTeam(); } }
};

App.init();