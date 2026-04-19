import { supabase } from '../supabase.js';

const ClientApp = {
    ticketId: null,
    customerId: null,
    messageSub: null,
    currentLang: 'pt',
    hasRated: false,
    allSubjects: [], // Guarda os assuntos originais para traduzir dinamicamente

    // Dicionário Estático da Tela do Cliente
    i18n: {
        'pt': {
            'lbl-greeting': 'Como podemos ajudar?',
            'lbl-subtitle': 'Abra um novo chamado ou acompanhe um atendimento.',
            'lbl-name': 'Seu Nome',
            'lbl-email': 'Seu E-mail',
            'lbl-subject': 'Motivo do Contato',
            'lbl-select-topic': 'Selecione um assunto...',
            'lbl-message': 'Mensagem Inicial',
            'lbl-btn-start': 'Iniciar Atendimento',
            'btn-toggle-mode': 'Já tem um protocolo? Acompanhe aqui',
            'lbl-live-support': 'Atendimento Online',
            'chat-input': 'Digite sua mensagem aqui...',
            'lbl-rating-title': 'Atendimento Encerrado',
            'lbl-rating-desc': 'Como você avalia o suporte recebido?',
            'rating-comment': 'Gostaria de deixar um comentário sobre o atendimento?',
            'btn-submit-rating': 'Enviar Avaliação',
            'lbl-rating-skip': 'Pular'
        },
        'en': {
            'lbl-greeting': 'How can we help?',
            'lbl-subtitle': 'Open a new ticket or track an existing request.',
            'lbl-name': 'Your Name',
            'lbl-email': 'Your E-mail',
            'lbl-subject': 'Contact Reason',
            'lbl-select-topic': 'Select a topic...',
            'lbl-message': 'Initial Message',
            'lbl-btn-start': 'Start Support',
            'btn-toggle-mode': 'Already have a protocol? Track here',
            'lbl-live-support': 'Live Support',
            'chat-input': 'Type your message here...',
            'lbl-rating-title': 'Ticket Closed',
            'lbl-rating-desc': 'How would you rate the support provided?',
            'rating-comment': 'Would you like to leave a comment about your experience?',
            'btn-submit-rating': 'Submit Rating',
            'lbl-rating-skip': 'Skip'
        },
        'es': {
            'lbl-greeting': '¿Cómo podemos ayudar?',
            'lbl-subtitle': 'Abra un nuevo ticket o siga una solicitud existente.',
            'lbl-name': 'Su Nombre',
            'lbl-email': 'Su E-mail',
            'lbl-subject': 'Motivo del Contacto',
            'lbl-select-topic': 'Seleccione un tema...',
            'lbl-message': 'Mensaje Inicial',
            'lbl-btn-start': 'Iniciar Soporte',
            'btn-toggle-mode': '¿Ya tienes un protocolo? Sigue aquí',
            'lbl-live-support': 'Soporte en Vivo',
            'chat-input': 'Escriba su mensaje aquí...',
            'lbl-rating-title': 'Ticket Cerrado',
            'lbl-rating-desc': '¿Cómo calificaría el soporte recibido?',
            'rating-comment': '¿Le gustaría dejar un comentario sobre el servicio?',
            'btn-submit-rating': 'Enviar Calificación',
            'lbl-rating-skip': 'Saltar'
        }
    },

    async init() {
        window.clientApp = this;
        
        // Listener de Idioma (Agora com await para dar tempo de traduzir os motivos)
        document.getElementById('client-language-select')?.addEventListener('change', async (e) => {
            await this.setLanguage(e.target.value);
        });

        await this.loadSubjects();

        document.getElementById('ticket-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('btn-start');
            const orig = btn.innerHTML;
            btn.innerHTML = `<span class="material-symbols-outlined animate-spin">refresh</span>`;
            
            const isTracking = document.getElementById('new-ticket-fields').classList.contains('hidden-view');
            const email = document.getElementById('client-email').value;

            try {
                if (isTracking) {
                    await this.trackTicket(email);
                } else {
                    await this.createTicket();
                }
            } catch(err) {
                alert("Erro: " + err.message);
            } finally {
                btn.innerHTML = orig;
            }
        });

        document.getElementById('client-chat-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const input = document.getElementById('chat-input');
            const text = input.value.trim();
            if (!text || !this.ticketId) return;

            // Mostra na tela na mesma hora
            this.renderMsg(text, 'customer');
            input.value = '';

            try {
                // Ao salvar no banco, mandamos o texto original. O agente traduz lá na ponta dele.
                await this.sendMessage(text);
            } catch(err) {
                alert("Falha ao enviar.");
            }
        });

        // Configuração de Estrelas NPS
        this.setupRatingStars();
    },

    async setLanguage(lang) {
        this.currentLang = lang;
        const dict = this.i18n[lang];
        if (!dict) return;

        // Traduz os textos fixos da tela
        for (const [id, text] of Object.entries(dict)) {
            const el = document.getElementById(id);
            if (el) {
                if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.placeholder = text;
                else el.innerText = text;
            }
        }
        
        // Refaz a lista de assuntos traduzida
        await this.renderSubjects();
        
        // Força a recarga da tela de chat para traduzir mensagens recebidas
        if (this.ticketId) {
            this.loadChat(this.ticketId);
        }
    },

    async translate(text) {
        if (!text || this.currentLang === 'pt') return text;
        try {
            const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${this.currentLang}&dt=t&q=${encodeURIComponent(text)}`);
            const data = await res.json();
            let translated = '';
            data[0].forEach(item => translated += item[0]);
            return translated;
        } catch(e) {
            return text;
        }
    },

    // Busca os assuntos do banco apenas uma vez e salva na memória
    async loadSubjects() {
        const { data, error } = await supabase.from('ticket_subjects').select('*').eq('is_active', true);
        if (error) return;
        this.allSubjects = data;
        await this.renderSubjects();
    },

    // Renderiza a lista de assuntos e traduz on-the-fly
    async renderSubjects() {
        const select = document.getElementById('client-subject');
        if (!select) return;

        const placeholderText = this.i18n[this.currentLang]['lbl-select-topic'] || 'Selecione um assunto...';
        
        // Limpa tudo, mas recoloca o placeholder traduzido
        select.innerHTML = `<option value="" disabled selected id="lbl-select-topic">${placeholderText}</option>`;
        
        for (const sub of this.allSubjects) {
            const translatedLabel = await this.translate(sub.label);
            select.innerHTML += `<option value="${sub.id}">${translatedLabel}</option>`;
        }
    },

    toggleViewMode() {
        const isTracking = document.getElementById('new-ticket-fields').classList.contains('hidden-view');
        const btnStart = document.getElementById('lbl-btn-start');
        const btnToggle = document.getElementById('btn-toggle-mode');
        
        if (isTracking) {
            document.getElementById('new-ticket-fields').classList.remove('hidden-view');
            document.getElementById('client-subject').required = true;
            document.getElementById('client-initial-message').required = true;
            
            const txtBtn = this.i18n[this.currentLang]['lbl-btn-start'];
            const txtTog = this.i18n[this.currentLang]['btn-toggle-mode'];
            btnStart.innerText = txtBtn || "Iniciar Atendimento";
            btnToggle.innerText = txtTog || "Já tem um protocolo? Acompanhe aqui";
        } else {
            document.getElementById('new-ticket-fields').classList.add('hidden-view');
            document.getElementById('client-subject').required = false;
            document.getElementById('client-initial-message').required = false;
            
            btnStart.innerText = this.currentLang === 'en' ? "Track Ticket" : (this.currentLang === 'es' ? "Rastrear" : "Acompanhar Chamado");
            btnToggle.innerText = this.currentLang === 'en' ? "Open new ticket" : (this.currentLang === 'es' ? "Abrir nuevo" : "Abrir novo chamado");
        }
    },

    async createTicket() {
        const name = document.getElementById('client-name').value;
        const email = document.getElementById('client-email').value;
        const subjectId = document.getElementById('client-subject').value;
        const message = document.getElementById('client-initial-message').value;

        // Verifica Cliente
        let { data: customer } = await supabase.from('customers').select('id').eq('email', email).single();
        if (!customer) {
            const { data: newCustomer, error: errC } = await supabase.from('customers').insert([{ full_name: name, email: email }]).select().single();
            if (errC) throw errC;
            customer = newCustomer;
        }
        this.customerId = customer.id;

        // Cria Ticket
        const { data: ticket, error: errT } = await supabase.from('tickets').insert([{ 
            customer_id: customer.id, 
            subject_id: subjectId, 
            channel: 'web', 
            status: 'open',
            last_sender: 'customer',
            last_interaction_at: new Date()
        }]).select('id, protocol_number, ticket_subjects(label)').single();
        if (errT) throw errT;
        
        this.ticketId = ticket.id;

        // Envia primeira mensagem
        await this.sendMessage(message);

        // Muda Tela
        this.setupChatUI(ticket);
        this.loadChat(ticket.id);
    },

    async trackTicket(email) {
        const { data: customer } = await supabase.from('customers').select('id').eq('email', email).single();
        if (!customer) throw new Error("E-mail não encontrado.");
        
        this.customerId = customer.id;

        const { data: tickets, error } = await supabase.from('tickets')
            .select('id, protocol_number, status, ticket_subjects(label)')
            .eq('customer_id', customer.id)
            .order('created_at', { ascending: false })
            .limit(1);

        if (error || tickets.length === 0) throw new Error("Nenhum chamado aberto.");
        
        const ticket = tickets[0];
        this.ticketId = ticket.id;
        
        this.setupChatUI(ticket);
        this.loadChat(ticket.id);

        if (ticket.status === 'closed') {
            this.showRatingModal();
        }
    },

    setupChatUI(ticket) {
        document.getElementById('view-start').classList.add('hidden-view');
        document.getElementById('view-chat').classList.remove('hidden-view');
        document.getElementById('chat-protocol').innerText = `HZ-${ticket.protocol_number}`;
        
        // Traduz o assunto que fica fixo no topo do chat também
        this.translate(ticket.ticket_subjects?.label || '').then(res => {
            document.getElementById('chat-subject').innerText = res;
        });
    },

    async loadChat(ticketId) {
        const { data: msgs } = await supabase.from('messages').select('*').eq('ticket_id', ticketId).order('created_at', { ascending: true });
        
        const container = document.getElementById('chat-messages-container');
        container.innerHTML = '';
        
        for (let m of msgs) {
            // Traduz a mensagem se foi o Agente ou o Sistema que mandou
            let textToShow = m.content;
            if (m.sender_type !== 'customer') {
                textToShow = await this.translate(m.content);
            }
            this.renderMsg(textToShow, m.sender_type);
        }

        if (this.messageSub) this.messageSub.unsubscribe();
        
        this.messageSub = supabase.channel(`client-${ticketId}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `ticket_id=eq.${ticketId}` }, async payload => {
                if (payload.new.sender_type !== 'customer') {
                    const translatedText = await this.translate(payload.new.content);
                    this.renderMsg(translatedText, payload.new.sender_type);
                }
            })
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tickets', filter: `id=eq.${ticketId}` }, payload => {
                if (payload.new.status === 'closed') {
                    this.showRatingModal();
                }
            }).subscribe();
    },

    renderMsg(text, type) {
        const isClient = type === 'customer';
        const container = document.getElementById('chat-messages-container');
        
        if (type === 'system') {
            container.innerHTML += `<div class="msg-system">${text}</div>`;
        } else {
            container.innerHTML += `
            <div class="flex ${isClient ? 'justify-end' : 'justify-start'} w-full">
                <div class="max-w-[85%] p-4 rounded-3xl text-sm font-medium shadow-sm ${isClient ? 'msg-client' : 'msg-agent'} whitespace-pre-wrap">
                    ${text}
                </div>
            </div>`;
        }
        
        const history = document.getElementById('chat-history');
        history.scrollTop = history.scrollHeight;
    },

    async sendMessage(text) {
        const payload = { ticket_id: this.ticketId, sender_type: 'customer', content: text };
        await supabase.from('messages').insert([payload]);
        await supabase.from('tickets').update({ last_sender: 'customer', last_interaction_at: new Date(), has_warning_sent: false }).eq('id', this.ticketId);
    },

    leaveChat() {
        location.reload();
    },

    // ==========================================
    // SISTEMA DE AVALIAÇÃO NPS E COMENTÁRIOS
    // ==========================================
    showRatingModal() {
        if (this.hasRated) return; // Se já avaliou na sessão atual, não incomoda de novo
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
                
                // Pintar estrelas selecionadas
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

                // Mostra a caixa de comentário e o botão de enviar
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
                await supabase.from('tickets').update({ 
                    rating: selectedRating,
                    rating_comment: comment 
                }).eq('id', this.ticketId);
                
                this.hasRated = true;
                
                // Agradecimento
                document.getElementById('view-rating').innerHTML = `
                    <div class="bg-white border border-slate-200 p-8 rounded-3xl shadow-2xl max-w-md w-full text-center">
                        <div class="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4"><span class="material-symbols-outlined text-3xl">favorite</span></div>
                        <h3 class="text-2xl font-black text-slate-900 mb-2">${this.currentLang === 'pt' ? 'Obrigado!' : (this.currentLang === 'en' ? 'Thank You!' : '¡Gracias!')}</h3>
                        <p class="text-sm font-medium text-slate-500 mb-8">${this.currentLang === 'pt' ? 'Sua avaliação nos ajuda a melhorar.' : (this.currentLang === 'en' ? 'Your feedback helps us improve.' : 'Sus comentarios nos ayudan a mejorar.')}</p>
                        <button onclick="location.reload()" class="w-full bg-slate-900 text-white font-bold py-3 rounded-xl shadow-lg">OK</button>
                    </div>
                `;
            } catch(e) {
                alert("Erro ao salvar avaliação.");
                btn.innerHTML = "Tentar Novamente"; btn.disabled = false;
            }
        });
    }
};

ClientApp.init();