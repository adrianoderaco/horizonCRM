// Arquivo: js/client/app.js
import { clientAPI } from './api.js';

const App = {
    currentTicketId: null,

    async init() {
        window.clientApp = this; // Expoe pro HTML pra usar no onclick dos botões NPS
        
        await this.loadSubjects();
        this.renderNPSButtons(); // Desenha os botões de 1 a 10

        document.getElementById('btn-chat').addEventListener('click', () => this.processForm('chat'));
        document.getElementById('btn-email').addEventListener('click', () => this.processForm('email'));

        document.getElementById('chat-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const input = document.getElementById('chat-input');
            const text = input.value.trim();
            if(!text || !this.currentTicketId) return;
            
            this.renderMessage(text, 'customer');
            input.value = '';
            await clientAPI.sendMessage(this.currentTicketId, text);
        });
    },

    async loadSubjects() {
        try {
            const subjects = await clientAPI.getSubjects();
            const select = document.getElementById('ticket-subject');
            select.innerHTML = '<option value="">Selecione um assunto...</option>';
            subjects.forEach(sub => select.innerHTML += `<option value="${sub.id}">${sub.label}</option>`);
        } catch (error) { console.error("Erro assuntos:", error); }
    },

    renderNPSButtons() {
        const container = document.getElementById('nps-buttons');
        let html = '';
        for (let i = 1; i <= 10; i++) {
            // Cores baseadas na nota (Detratores: Vermelho, Neutros: Amarelo, Promotores: Verde)
            let colorClass = 'bg-slate-100 text-slate-600 hover:bg-slate-200';
            if (i <= 6) colorClass = 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-100';
            else if (i <= 8) colorClass = 'bg-amber-50 text-amber-600 hover:bg-amber-100 border border-amber-100';
            else colorClass = 'bg-green-50 text-green-600 hover:bg-green-100 border border-green-100';

            html += `<button onclick="clientApp.submitNPS(${i}, this)" class="w-10 h-10 sm:w-12 sm:h-12 rounded-xl font-black text-sm sm:text-base transition-all ${colorClass}">${i}</button>`;
        }
        container.innerHTML = html;
    },

    async processForm(channel) {
        const name = document.getElementById('client-name').value.trim();
        const email = document.getElementById('client-email').value.trim();
        const subjectId = document.getElementById('ticket-subject').value;
        const orderNumber = document.getElementById('client-order').value.trim();
        const message = document.getElementById('client-message').value.trim();

        if (!name || !email || !subjectId || !message) {
            alert("Preencha os campos obrigatórios.");
            return;
        }

        const btn = document.getElementById(`btn-${channel}`);
        const originalText = btn.innerHTML;
        btn.innerHTML = `<span class="material-symbols-outlined animate-spin">refresh</span> Processando...`;
        btn.disabled = true;

        try {
            const customer = await clientAPI.getOrCreateCustomer(name, email);
            const ticket = await clientAPI.createTicket(customer.id, subjectId, channel, orderNumber);
            this.currentTicketId = ticket.id;
            
            await clientAPI.sendMessage(ticket.id, message);
            const protocoloVisual = `HZ-${ticket.protocol_number}`;

            document.getElementById('view-contact').classList.add('hidden-view');

            if (channel === 'chat') {
                document.getElementById('view-chat').classList.remove('hidden-view');
                document.getElementById('chat-protocol').innerText = protocoloVisual;
                this.renderMessage(message, 'customer');
                this.renderMessage("Protocolo gerado. Aguarde um analista.", 'system');
                
                // Escuta as mensagens do agente
                clientAPI.subscribeToMessages(ticket.id, (msg) => this.renderMessage(msg, 'agent'));

                // ESCUTA O STATUS DO TICKET (Para fechar o chat e abrir NPS)
                clientAPI.subscribeToTicketStatus(ticket.id, (status) => {
                    if (status === 'closed') {
                        document.getElementById('view-chat').classList.add('hidden-view');
                        document.getElementById('view-nps').classList.remove('hidden-view');
                    }
                });

            } else {
                document.getElementById('view-success').classList.remove('hidden-view');
                document.getElementById('success-protocol').innerText = protocoloVisual;
            }

        } catch (error) {
            alert("Erro ao abrir ticket.");
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    },

    async submitNPS(rating, btnElement) {
        try {
            // Dá um feedback visual na nota escolhida
            const buttons = document.getElementById('nps-buttons').querySelectorAll('button');
            buttons.forEach(b => { b.disabled = true; b.style.opacity = '0.5'; });
            btnElement.style.opacity = '1';
            btnElement.classList.add('ring-4', 'ring-offset-2', 'ring-blue-400');

            // Envia pro banco
            await clientAPI.submitNPS(this.currentTicketId, rating);
            
            // Mostra agradecimento
            document.getElementById('nps-thanks').classList.remove('hidden-view');
        } catch (error) {
            console.error("Erro ao salvar NPS:", error);
            alert("Erro ao registrar avaliação.");
        }
    },

    renderMessage(text, sender) {
        const area = document.getElementById('chat-area');
        if (sender === 'system') {
            area.innerHTML += `<div class="flex justify-center my-4"><span class="bg-slate-100 text-slate-500 text-xs font-bold px-4 py-1 rounded-full">${text}</span></div>`;
        } else {
            const isCust = sender === 'customer';
            area.innerHTML += `
                <div class="flex items-start gap-3 max-w-[85%] mt-4 ${isCust ? 'ml-auto flex-row-reverse' : ''}">
                    <div class="${isCust ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-slate-100 text-slate-800 rounded-tl-none border border-slate-200'} p-4 rounded-2xl text-sm shadow-sm whitespace-pre-wrap">${text}</div>
                </div>`;
        }
        area.scrollTop = area.scrollHeight;
    }
};

App.init();