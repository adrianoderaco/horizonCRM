// Arquivo: js/client/app.js
import { clientAPI } from './api.js';

const App = {
    currentTicketId: null,

    async init() {
        // 1. Ao carregar a página, puxa os assuntos do banco
        await this.loadSubjects();

        // 2. Monitorar os botões de ação
        document.getElementById('btn-chat').addEventListener('click', () => this.processForm('chat'));
        document.getElementById('btn-email').addEventListener('click', () => this.processForm('email'));

        // 3. Monitorar o envio de mensagens de dentro do chat
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
            
            subjects.forEach(sub => {
                select.innerHTML += `<option value="${sub.id}">${sub.label}</option>`;
            });
        } catch (error) {
            console.error("Erro ao buscar assuntos:", error);
        }
    },

    async processForm(channel) {
        // Coleta os dados do form
        const name = document.getElementById('client-name').value.trim();
        const email = document.getElementById('client-email').value.trim();
        const subjectId = document.getElementById('ticket-subject').value;
        const orderNumber = document.getElementById('client-order').value.trim();
        const message = document.getElementById('client-message').value.trim();

        // Validação básica
        if (!name || !email || !subjectId || !message) {
            alert("Por favor, preencha todos os campos obrigatórios (*).");
            return;
        }

        // Feedback visual no botão
        const btn = document.getElementById(`btn-${channel}`);
        const originalText = btn.innerHTML;
        btn.innerHTML = `<span class="material-symbols-outlined animate-spin">refresh</span> Processando...`;
        btn.disabled = true;

        try {
            // Regra de Negócio Centralizada
            const customer = await clientAPI.getOrCreateCustomer(name, email);
            const ticket = await clientAPI.createTicket(customer.id, subjectId, channel, orderNumber);
            this.currentTicketId = ticket.id;
            
            // Salva a mensagem inicial como primeira mensagem do ticket
            await clientAPI.sendMessage(ticket.id, message);

            const protocoloVisual = `HZ-${ticket.protocol_number}`;

            // Define para qual tela o usuário vai
            document.getElementById('view-contact').classList.add('hidden-view');

            if (channel === 'chat') {
                document.getElementById('view-chat').classList.remove('hidden-view');
                document.getElementById('chat-protocol').innerText = protocoloVisual;
                this.renderMessage(message, 'customer');
                this.renderMessage("Protocolo gerado com sucesso. Aguarde um instante, um analista já irá te atender.", 'system');
                
                // Começa a escutar o analista
                clientAPI.subscribeToMessages(ticket.id, (msg) => {
                    this.renderMessage(msg, 'agent');
                });
            } else {
                document.getElementById('view-success').classList.remove('hidden-view');
                document.getElementById('success-protocol').innerText = protocoloVisual;
            }

        } catch (error) {
            console.error(error);
            alert("Ocorreu um erro ao conectar ao servidor. Tente novamente.");
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    },

    renderMessage(text, sender) {
        const area = document.getElementById('chat-area');
        
        if (sender === 'system') {
            area.innerHTML += `
                <div class="flex justify-center my-4">
                    <span class="bg-slate-100 text-slate-500 text-xs font-bold px-4 py-1 rounded-full">${text}</span>
                </div>
            `;
        } else {
            const isCust = sender === 'customer';
            area.innerHTML += `
                <div class="flex items-start gap-3 max-w-[85%] mt-4 ${isCust ? 'ml-auto flex-row-reverse' : ''}">
                    <div class="${isCust ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-slate-100 text-slate-800 rounded-tl-none border border-slate-200'} p-4 rounded-2xl text-sm shadow-sm whitespace-pre-wrap">${text}</div>
                </div>
            `;
        }
        area.scrollTop = area.scrollHeight;
    }
};

// Inicia a aplicação
App.init();