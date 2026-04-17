// Arquivo: js/agent/app.js
import { agentAPI } from './api.js';

const App = {
    activeTicketId: null,
    messageSub: null,

    init() {
        window.agentApp = this; 

        // Lógica de Login
        document.getElementById('login-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('btn-login');
            const originalText = btn.innerHTML;
            btn.innerHTML = `<span class="material-symbols-outlined animate-spin">refresh</span> Autenticando...`;
            
            try {
                await agentAPI.login(document.getElementById('login-email').value, document.getElementById('login-pass').value);
                document.getElementById('view-login').classList.add('hidden-view');
                document.getElementById('view-app').classList.remove('hidden-view');
                
                this.loadQueue();
                agentAPI.subscribeToQueue(() => this.loadQueue());
            } catch (error) {
                alert("Erro no login.");
                btn.innerHTML = originalText;
            }
        });

        // Envio de mensagens pelo Agente
        document.getElementById('agent-chat-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const input = document.getElementById('chat-input');
            const text = input.value.trim();
            if(!text || !this.activeTicketId) return;
            
            this.renderMsg(text, 'agent'); // Renderiza na tela na hora
            input.value = '';
            await agentAPI.sendMessage(this.activeTicketId, text); // Salva no banco
        });
    },

    navigate(target) {
        ['queue', 'chat'].forEach(s => document.getElementById(`sec-${s}`).classList.add('hidden-view'));
        document.getElementById(`sec-${target}`).classList.remove('hidden-view');
    },

    async loadQueue() {
        const tickets = await agentAPI.getPendingTickets();
        const tbody = document.getElementById('queue-tbody');
        document.getElementById('queue-count').innerText = `${tickets.length} tickets`;

        if (tickets.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="p-10 text-center font-bold text-slate-300">Nenhum ticket pendente.</td></tr>`;
            return;
        }

        tbody.innerHTML = tickets.map(t => `
            <tr class="hover:bg-slate-50 transition-colors">
                <td class="p-5 font-black text-slate-900">HZ-${t.protocol_number} <span class="text-xs uppercase bg-slate-200 text-slate-600 px-2 rounded ml-2">${t.channel}</span></td>
                <td class="p-5 font-black text-slate-900">${t.customers.full_name} <br><span class="text-[11px] text-slate-400 font-bold">${t.customers.email}</span></td>
                <td class="p-5 font-bold text-sm text-slate-600">${t.ticket_subjects ? t.ticket_subjects.label : '---'}</td>
                <td class="p-5 text-right">
                    <button onclick="agentApp.pickTicket('${t.id}')" class="bg-slate-900 text-white px-5 py-2.5 rounded-xl text-xs font-black hover:bg-blue-600">Atender</button>
                </td>
            </tr>
        `).join('');
    },

    async pickTicket(id) {
        this.activeTicketId = id;
        this.navigate('chat');
        document.getElementById('menu-chat').classList.remove('hidden-view');
        document.getElementById('chat-history').innerHTML = '';

        // Carrega dados do Ticket no CRM
        const t = await agentAPI.getTicketDetails(id);
        
        document.getElementById('chat-header-name').innerText = t.customers.full_name;
        document.getElementById('chat-header-protocol').innerText = `HZ-${t.protocol_number}`;
        
        document.getElementById('crm-name').innerText = t.customers.full_name;
        document.getElementById('crm-email').innerText = t.customers.email;
        document.getElementById('crm-tag1').innerText = t.ticket_subjects ? t.ticket_subjects.label : 'Sem assunto';
        
        // Se já tinha alguma TAG 2 (ou anotação de pedido)
        document.getElementById('crm-tag2').value = t.tag2_detail || '';

        // Carrega Histórico
        const msgs = await agentAPI.getMessages(id);
        msgs.forEach(m => this.renderMsg(m.content, m.sender_type));

        // Inscreve no Realtime
        if (this.messageSub) this.messageSub.unsubscribe();
        this.messageSub = agentAPI.subscribeToMessages(id, (msg) => this.renderMsg(msg, 'customer'));
    },

    renderMsg(text, type) {
        const isAgent = type === 'agent';
        const area = document.getElementById('chat-history');
        area.innerHTML += `
            <div class="flex ${isAgent ? 'justify-end' : 'justify-start'} w-full">
                <div class="max-w-[80%] p-4 rounded-2xl text-sm font-medium shadow-sm ${isAgent ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-white text-slate-800 rounded-tl-none border'}">
                    ${text}
                </div>
            </div>
        `;
        area.scrollTop = area.scrollHeight;
    },

    async closeTicket() {
        if (!confirm("Tem certeza que deseja finalizar este atendimento? O ticket será fechado.")) return;
        
        const tag2 = document.getElementById('crm-tag2').value.trim();
        
        try {
            await agentAPI.closeTicket(this.activeTicketId, tag2);
            alert("Atendimento finalizado com sucesso!");
            
            // Limpa a tela e volta pra fila
            this.activeTicketId = null;
            document.getElementById('menu-chat').classList.add('hidden-view');
            this.navigate('queue');
            
        } catch (error) {
            alert("Erro ao fechar o ticket.");
            console.error(error);
        }
    }
};

App.init();