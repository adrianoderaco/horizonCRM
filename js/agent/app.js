// Arquivo: js/agent/app.js
import { agentAPI } from './api.js';

const App = {
    init() {
        // Expor a função navigate para o HTML poder usar no onclick do menu
        window.agentApp = this; 

        document.getElementById('login-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('btn-login');
            const originalText = btn.innerHTML;
            btn.innerHTML = `<span class="material-symbols-outlined animate-spin">refresh</span> Autenticando...`;
            
            const email = document.getElementById('login-email').value;
            const pass = document.getElementById('login-pass').value;

            try {
                await agentAPI.login(email, pass);
                
                // Sucesso! Mostra o app
                document.getElementById('view-login').classList.add('hidden-view');
                document.getElementById('view-app').classList.remove('hidden-view');
                
                // Carrega a fila e começa a escutar o realtime
                this.loadQueue();
                agentAPI.subscribeToQueue(() => this.loadQueue());

            } catch (error) {
                alert("Erro no login. Verifique suas credenciais.");
                btn.innerHTML = originalText;
            }
        });
    },

    navigate(target) {
        // No momento só temos a fila, preparativo para a tela de chat/crm
        console.log(`Navegando para: ${target}`);
    },

    async loadQueue() {
        try {
            const tickets = await agentAPI.getPendingTickets();
            const tbody = document.getElementById('queue-tbody');
            const countEl = document.getElementById('queue-count');
            
            countEl.innerText = `${tickets.length} ticket(s)`;

            if (tickets.length === 0) {
                tbody.innerHTML = `<tr><td colspan="4" class="p-10 text-center font-bold text-slate-300">Nenhum ticket pendente. Ótimo trabalho!</td></tr>`;
                return;
            }

            tbody.innerHTML = tickets.map(t => {
                const icon = t.channel === 'chat' ? 'forum' : 'mail';
                const channelColor = t.channel === 'chat' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700';
                
                return `
                <tr class="hover:bg-slate-50 transition-colors group">
                    <td class="p-5">
                        <div class="font-black text-slate-900">HZ-${t.protocol_number}</div>
                        <div class="mt-1 flex items-center gap-1 w-fit px-2 py-0.5 rounded text-[10px] font-bold uppercase ${channelColor}">
                            <span class="material-symbols-outlined text-[12px]">${icon}</span> ${t.channel}
                        </div>
                    </td>
                    <td class="p-5">
                        <div class="font-black text-slate-900">${t.customers.full_name}</div>
                        <div class="text-[11px] font-bold text-slate-400">${t.customers.email}</div>
                    </td>
                    <td class="p-5">
                        <span class="bg-slate-100 text-slate-600 text-xs font-bold px-3 py-1 rounded-lg border border-slate-200">
                            ${t.ticket_subjects ? t.ticket_subjects.label : 'Sem assunto'}
                        </span>
                    </td>
                    <td class="p-5 text-right">
                        <button onclick="alert('Tela de CRM (Chat/TAG2) em desenvolvimento!')" class="bg-slate-900 text-white px-5 py-2.5 rounded-xl text-xs font-black hover:bg-blue-600 transition-all">Atender</button>
                    </td>
                </tr>
                `;
            }).join('');

        } catch (error) {
            console.error("Erro ao carregar a fila:", error);
        }
    }
};

App.init();