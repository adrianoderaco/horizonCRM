// Arquivo: js/agent/app.js
import { agentAPI } from './api.js';
import { supabase } from '../supabase.js';
import { Orchestrator } from './orchestrator.js';

const App = {
    activeTicketId: null,
    messageSub: null,
    isRegisterMode: false,
    currentUser: null,
    currentCustomer: null,
    allSubjects: [],
    activeAgents: [],

    init() {
        window.agentApp = this; 

        window.addEventListener('ticket-assigned', (e) => {
            this.pickTicket(e.detail.id); 
        });

        document.getElementById('login-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('btn-login');
            const originalText = btn.innerHTML;
            btn.innerHTML = `<span class="material-symbols-outlined animate-spin">refresh</span> Processando...`;
            
            const email = document.getElementById('login-email').value;
            const pass = document.getElementById('login-pass').value;

            if (this.isRegisterMode) {
                const name = document.getElementById('reg-name').value;
                try {
                    await agentAPI.register(name, email, pass);
                    alert("Aguarde aprovação do gestor.");
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
                
                // EXIBE MENUS DE GESTOR (INCLUINDO DASHBOARD)
                if (profile.role === 'gestor') {
                    document.getElementById('menu-team').classList.remove('hidden-view');
                    document.getElementById('menu-dashboard').classList.remove('hidden-view');
                    document.getElementById('wrapper-routing').classList.remove('hidden-view');
                }
                
                document.getElementById('toggle-routing').checked = profile.is_routing_active;
                Orchestrator.init(profile.id, profile.is_routing_active);

                this.loadQueue();
                agentAPI.subscribeToQueue(() => this.loadQueue());

            } catch (error) { 
                alert("Erro no login."); 
                btn.innerHTML = originalText;
            }
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

    toggleAuthMode() {
        this.isRegisterMode = !this.isRegisterMode;
        document.getElementById('auth-title').innerText = this.isRegisterMode ? "Solicitar Acesso" : "Acesso Restrito";
        document.getElementById('btn-login').innerHTML = this.isRegisterMode ? 'Criar Conta' : 'Entrar <span class="material-symbols-outlined">login</span>';
        const regName = document.getElementById('reg-name');
        if (this.isRegisterMode) { regName.classList.remove('hidden-view'); regName.required = true; } 
        else { regName.classList.add('hidden-view'); regName.required = false; }
    },

    navigate(target) {
        ['queue', 'chat', 'team'].forEach(s => document.getElementById(`sec-${s}`)?.classList.add('hidden-view'));
        document.getElementById(`sec-${target}`).classList.remove('hidden-view');
        if(target === 'team') this.loadTeam();
    },

    async toggleRouting(isActive) {
        try {
            await agentAPI.updateRoutingStatus(this.currentUser.id, isActive);
            Orchestrator.setStatus(isActive); 
        } catch(e) { document.getElementById('toggle-routing').checked = !isActive; }
    },

    async loadQueue() {
        const tickets = await agentAPI.getPendingTickets();
        const tbody = document.getElementById('queue-tbody');
        const countEl = document.getElementById('queue-count');
        if(countEl) countEl.innerText = `${tickets.length} tickets`;
        if (tickets.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="p-10 text-center text-slate-300 font-bold">Nenhum ticket pendente.</td></tr>`;
            return;
        }
        tbody.innerHTML = tickets.map(t => `
            <tr class="hover:bg-slate-50 transition-colors">
                <td class="p-5 font-black text-slate-900">HZ-${t.protocol_number} <span class="text-[10px] bg-slate-200 px-2 py-0.5 rounded ml-2">${t.channel}</span></td>
                <td class="p-5 font-black text-slate-900">${t.customers.full_name}</td>
                <td class="p-5 font-bold text-sm text-slate-600">${t.ticket_subjects?.label || '---'}</td>
                <td class="p-5 text-right"><button onclick="agentApp.pickTicket('${t.id}')" class="bg-slate-900 text-white px-5 py-2 rounded-xl text-xs font-black hover:bg-blue-600 transition-all">Atender</button></td>
            </tr>`).join('');
    },

    async pickTicket(id) {
        this.activeTicketId = id;
        this.navigate('chat');
        document.getElementById('menu-chat').classList.remove('hidden-view');
        document.getElementById('chat-history').innerHTML = '';
        this.switchTab('crm-info'); // Força abrir na aba de dados

        const t = await agentAPI.getTicketDetails(id);
        this.currentCustomer = t.customers; // Armazena cliente atual para usar nos pedidos
        
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

    // --- FUNÇÕES DA BARRA LATERAL CRM ---
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
            if (a.id !== this.currentUser.id) agSelect.innerHTML += `<option value="${a.id}">${a.full_name}</option>`;
        });
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
                    <div>
                        <div class="text-[10px] font-black text-slate-400">HZ-${h.protocol_number}</div>
                        <div class="text-xs font-bold text-slate-700 truncate max-w-[200px]">${h.ticket_subjects?.label || 'S/ Assunto'}</div>
                        <div class="text-[10px] text-slate-400">${new Date(h.created_at).toLocaleDateString()}</div>
                    </div>
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
            await agentAPI.createOrder({
                customer_id: this.currentCustomer.id,
                product_name: product,
                quantity: parseInt(qty),
                amount: parseFloat(amount.replace(',', '.'))
            });
            document.getElementById('order-product').value = '';
            document.getElementById('order-amount').value = '';
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
                    <div>
                        <div class="text-xs font-black text-slate-800">${o.product_name}</div>
                        <div class="text-[10px] font-bold text-slate-500">${o.quantity} un • R$ ${o.amount.toFixed(2).replace('.', ',')}</div>
                    </div>
                    <div class="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-1 rounded">${new Date(o.created_at).toLocaleDateString()}</div>
                </div>
            `).join('');
        } catch (e) { console.error(e); }
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

    async approveMember(id) {
        if(confirm("Aprovar?")) { await agentAPI.approveUser(id, 'analista'); this.loadTeam(); }
    },

    async toggleSkill(agentId, subjectId, isAdding) {
        try { await agentAPI.toggleAgentSkill(agentId, subjectId, isAdding); } 
        catch (e) { this.loadTeam(); }
    }
};

App.init();