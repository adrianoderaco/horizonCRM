import { clientAPI } from './api.js';

const ClientApp = {
    ticketId: null,
    customerId: null,
    currentLang: 'pt',
    hasRated: false,
    allSubjects: [],

    async init() {
        window.clientApp = this;

        document.getElementById('client-language-select')?.addEventListener('change', async (e) => {
            this.setLanguage(e.target.value);
        });

        await this.loadSubjects();

        document.getElementById('ticket-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('btn-start'); const orig = btn.innerHTML;
            btn.innerHTML = `<span class="material-symbols-outlined animate-spin notranslate">refresh</span>`;
            
            const isTracking = document.getElementById('new-ticket-fields').classList.contains('hidden-view');
            const email = document.getElementById('client-email').value;

            try {
                if (isTracking) await this.trackTicket(email);
                else await this.createTicket();
            } catch(err) { alert("Erro: " + err.message); } finally { btn.innerHTML = orig; }
        });

        document.getElementById('client-chat-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const input = document.getElementById('chat-input');
            const text = input.value.trim();
            if (!text || !this.ticketId) return;

            this.renderMsg(text, 'customer');
            input.value = '';

            try { await clientAPI.sendMessage(this.ticketId, text); } catch(err) { alert("Falha ao enviar."); }
        });

        document.getElementById('btn-leave')?.addEventListener('click', () => location.reload());
        document.getElementById('btn-leave-rating')?.addEventListener('click', () => location.reload());

        this.setupRatingStars();
    },

    playAlert() {
        try {
            const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3');
            audio.play();
        } catch(e) {}
    },

    setLanguage(lang) {
        this.currentLang = lang;
        const selectField = document.querySelector(".goog-te-combo");
        if (selectField) {
            selectField.value = lang;
            selectField.dispatchEvent(new Event("change", { bubbles: true }));
        }
    },

    async loadSubjects() {
        try {
            this.allSubjects = await clientAPI.getActiveSubjects();
            const select = document.getElementById('client-subject');
            select.innerHTML = '<option value="" disabled selected>Selecione um assunto...</option>';
            this.allSubjects.forEach(sub => {
                select.innerHTML += `<option value="${sub.id}">${sub.label}</option>`;
            });
        } catch (e) { console.error(e); }
    },

    toggleViewMode() {
        const isTracking = document.getElementById('new-ticket-fields').classList.contains('hidden-view');
        const btnStart = document.getElementById('btn-start').querySelector('span:first-child');
        const btnToggle = document.getElementById('btn-toggle-mode');
        
        if (isTracking) {
            document.getElementById('new-ticket-fields').classList.remove('hidden-view');
            document.getElementById('client-subject').required = true;
            document.getElementById('client-initial-message').required = true;
            btnStart.innerText = "Iniciar Atendimento";
            btnToggle.innerText = "Já tem um protocolo? Acompanhe aqui";
        } else {
            document.getElementById('new-ticket-fields').classList.add('hidden-view');
            document.getElementById('client-subject').required = false;
            document.getElementById('client-initial-message').required = false;
            btnStart.innerText = "Acompanhar Chamado";
            btnToggle.innerText = "Abrir novo chamado";
        }
    },

    async createTicket() {
        const name = document.getElementById('client-name').value;
        const email = document.getElementById('client-email').value;
        const subjectId = document.getElementById('client-subject').value;
        const message = document.getElementById('client-initial-message').value;

        let customer = await clientAPI.checkCustomer(email);
        if (!customer) {
            customer = await clientAPI.createCustomer({ full_name: name, email: email });
        }
        this.customerId = customer.id;

        const ticket = await clientAPI.createTicket(customer.id, subjectId, 'web');
        this.ticketId = ticket.id;

        await clientAPI.sendMessage(this.ticketId, message);

        const subLabel = this.allSubjects.find(s => s.id === subjectId)?.label || '';
        this.setupChatUI(ticket.protocol_number, subLabel);
        this.loadChat();
    },

    async trackTicket(email) {
        const customer = await clientAPI.checkCustomer(email);
        if (!customer) throw new Error("E-mail não encontrado.");
        
        this.customerId = customer.id;

        const { data: tickets, error } = await clientAPI.getMessages(customer.id); // Hack provisorio para testar
        throw new Error("Rastreamento de tickets ativos precisa de query específica.");
    },

    setupChatUI(protocol, subjectLabel) {
        document.getElementById('view-start').classList.add('hidden-view');
        document.getElementById('view-chat').classList.remove('hidden-view');
        document.getElementById('chat-protocol').innerText = `HZ-${protocol}`;
        document.getElementById('chat-subject').innerText = subjectLabel;
    },

    async loadChat() {
        try {
            const msgs = await clientAPI.getMessages(this.ticketId);
            const container = document.getElementById('chat-messages-container');
            container.innerHTML = '';
            
            msgs.forEach(m => this.renderMsg(m.content, m.sender_type));

            clientAPI.subscribeToMessages(this.ticketId, (content, type) => {
                this.playAlert();
                this.renderMsg(content, type);
            });

            clientAPI.subscribeToTicket(this.ticketId, (ticket) => {
                if (ticket.status === 'closed') this.showRatingModal();
            });

        } catch (e) { console.error("Erro ao carregar chat", e); }
    },

    renderMsg(text, type) {
        const isClient = type === 'customer';
        const container = document.getElementById('chat-messages-container');
        
        if (type === 'system') {
            container.innerHTML += `<div class="msg-system">${text}</div>`;
        } else {
            container.innerHTML += `
            <div class="flex ${isClient ? 'justify-end' : 'justify-start'} w-full notranslate">
                <div class="max-w-[85%] p-4 rounded-3xl text-sm font-medium shadow-sm ${isClient ? 'msg-client' : 'msg-agent'} whitespace-pre-wrap">
                    ${text}
                </div>
            </div>`;
        }
        
        const history = document.getElementById('chat-history');
        history.scrollTop = history.scrollHeight;
    },

    showRatingModal() {
        if (this.hasRated) return; 
        document.getElementById('chat-input-area').classList.add('hidden-view');
        document.getElementById('view-rating').classList.remove('hidden-view');
    },

    setupRatingStars() {
        const container = document.getElementById('rating-stars');
        let html = '';
        for(let i=1; i<=10; i++) {
            html += `<button type="button" class="w-8 h-8 rounded-full border-2 border-slate-200 text-slate-400 font-bold text-xs hover:bg-blue-50 hover:text-blue-600 hover:border-blue-300 transition-all star-btn" data-val="${i}">${i}</button>`;
        }
        container.innerHTML = html;

        let selectedRating = null;

        document.querySelectorAll('.star-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                selectedRating = parseInt(e.target.dataset.val);
                document.querySelectorAll('.star-btn').forEach(b => {
                    const val = parseInt(b.dataset.val);
                    if (val <= selectedRating) {
                        b.classList.add('bg-blue-600', 'text-white', 'border-blue-600');
                        b.classList.remove('border-slate-200', 'text-slate-400', 'bg-blue-50');
                    } else {
                        b.classList.remove('bg-blue-600', 'text-white', 'border-blue-600');
                        b.classList.add('border-slate-200', 'text-slate-400');
                    }
                });
                document.getElementById('rating-comment').classList.remove('hidden-view');
                document.getElementById('btn-submit-rating').classList.remove('hidden-view');
            });
        });

        document.getElementById('btn-submit-rating').addEventListener('click', async () => {
            if (!selectedRating || !this.ticketId) return;
            const comment = document.getElementById('rating-comment').value.trim();
            const btn = document.getElementById('btn-submit-rating');
            btn.innerHTML = "Enviando..."; btn.disabled = true;

            try {
                await clientAPI.submitNPS(this.ticketId, selectedRating, comment);
                this.hasRated = true;
                document.getElementById('view-rating').innerHTML = `
                    <div class="bg-white border border-slate-200 p-8 rounded-3xl shadow-2xl max-w-md w-full text-center">
                        <div class="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4"><span class="material-symbols-outlined notranslate text-3xl">favorite</span></div>
                        <h3 class="text-2xl font-black text-slate-900 mb-2">Obrigado!</h3>
                        <p class="text-sm font-medium text-slate-500 mb-8">Sua avaliação nos ajuda a melhorar.</p>
                        <button onclick="location.reload()" class="w-full bg-slate-900 text-white font-bold py-3 rounded-xl shadow-lg">OK</button>
                    </div>`;
            } catch(e) {
                alert("Erro ao salvar avaliação.");
                btn.innerHTML = "Tentar Novamente"; btn.disabled = false;
            }
        });
    }
};

ClientApp.init();