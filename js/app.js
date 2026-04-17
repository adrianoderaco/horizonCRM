// Inicialização
const supabase = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
let activeTicketId = null;

// Controle de Visuais (Single Page Application)
function switchView(viewName) {
    // Esconde todas as sections
    document.querySelectorAll('main > section').forEach(sec => sec.classList.add('hidden-view'));
    // Mostra a selecionada
    document.getElementById(`view-${viewName}`).classList.remove('hidden-view');
    
    // Atualiza botão ativo no Menu Lateral
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('text-blue-700', 'bg-blue-50', 'border-r-2', 'border-blue-700');
        link.classList.add('text-slate-500');
    });
    const activeLink = document.querySelector(`[onclick="switchView('${viewName}')"]`);
    if(activeLink) {
        activeLink.classList.remove('text-slate-500');
        activeLink.classList.add('text-blue-700', 'bg-blue-50', 'border-r-2', 'border-blue-700');
    }

    // Carrega os dados dependendo da tela
    if(viewName === 'queue') App.loadQueue();
    if(viewName === 'dashboard') App.loadDashboard();
    if(viewName === 'agents') App.loadAgents();
}

// Objeto Central da Aplicação
const App = {
    // Autenticação
    async init() {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
            document.getElementById('view-login').classList.add('hidden-view');
            document.getElementById('view-app').classList.remove('hidden-view');
            switchView('dashboard');
        }

        // Setup Login Form
        document.getElementById('login-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('login-email').value;
            const pass = document.getElementById('login-pass').value;
            const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
            if (error) alert("Erro: " + error.message);
            else window.location.reload();
        });

        // Setup Chat Form
        document.getElementById('btn-send').addEventListener('click', App.sendMessage);
    },

    async logout() {
        await supabase.auth.signOut();
        window.location.reload();
    },

    // 1. Dashboard
    async loadDashboard() {
        const { count: resolved } = await supabase.from('tickets').select('*', { count: 'exact', head: true }).eq('status', 'resolved');
        const { count: pending } = await supabase.from('tickets').select('*', { count: 'exact', head: true }).eq('status', 'pending');
        
        document.getElementById('dash-resolved').innerText = resolved || 0;
        document.getElementById('dash-backlog').innerText = pending || 0;
    },

    // 2. Fila (Queue)
    async loadQueue() {
        const { data: tickets } = await supabase.from('tickets')
            .select('*, customers(full_name, tier)')
            .eq('status', 'pending');
            
        const tbody = document.getElementById('queue-tbody');
        tbody.innerHTML = tickets.map(t => `
            <tr class="hover:bg-gray-50 transition-colors">
                <td class="py-4 px-6">
                    <p class="font-bold">${t.customers.full_name}</p>
                    <p class="text-[11px] text-gray-500">${t.customers.tier}</p>
                </td>
                <td class="py-4 px-6 text-sm">${t.subject}</td>
                <td class="py-4 px-6"><span class="bg-blue-100 text-blue-800 text-[10px] px-2 py-1 rounded-full uppercase font-bold">${t.channel}</span></td>
                <td class="py-4 px-6"><span class="bg-red-100 text-red-800 text-[10px] px-2 py-1 rounded-full uppercase font-bold">${t.priority}</span></td>
                <td class="py-4 px-6 text-right">
                    <button onclick="App.pickTicket('${t.id}', '${t.customers.full_name}', '${t.subject}')" class="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-4 py-2 rounded-lg">Atender</button>
                </td>
            </tr>
        `).join('');
    },

    // 3. Agentes
    async loadAgents() {
        const { data: agents } = await supabase.from('profiles').select('*');
        const tbody = document.getElementById('agents-tbody');
        tbody.innerHTML = agents.map(a => `
            <tr class="hover:bg-gray-50 transition-colors">
                <td class="px-8 py-4 font-bold text-sm">${a.full_name || a.email}</td>
                <td class="px-4 py-4 text-sm">${a.role}</td>
                <td class="px-4 py-4"><span class="text-xs font-bold text-green-600">Online</span></td>
            </tr>
        `).join('');
    },

    // 4. Lógica do Chat / Console
    async pickTicket(id, customerName, subject) {
        activeTicketId = id;
        
        // Atualiza a interface
        document.getElementById('chat-customer-name').innerText = customerName;
        document.getElementById('chat-subject').innerText = subject;
        document.getElementById('chat-avatar').innerText = customerName.charAt(0);
        
        // Habilita inputs
        document.getElementById('msg-input').disabled = false;
        document.getElementById('btn-send').disabled = false;
        
        // Vai para a tela de chat e carrega histórico
        switchView('chat');
        App.loadMessages();

        // Inscreve no Realtime para novas mensagens
        supabase.channel('mensagens')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `ticket_id=eq.${id}` }, payload => {
                App.renderSingleMessage(payload.new);
            }).subscribe();
    },

    async loadMessages() {
        if(!activeTicketId) return;
        const { data: msgs } = await supabase.from('messages').select('*').eq('ticket_id', activeTicketId).order('created_at', { ascending: true });
        
        const area = document.getElementById('messages-area');
        area.innerHTML = '';
        msgs.forEach(m => App.renderSingleMessage(m));
    },

    renderSingleMessage(msg) {
        const area = document.getElementById('messages-area');
        const isAgent = msg.sender_type === 'agent';
        area.innerHTML += `
            <div class="flex ${isAgent ? 'justify-end' : 'justify-start'}">
                <div class="max-w-[80%] p-4 rounded-2xl ${isAgent ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-gray-100 text-gray-800 rounded-tl-none'}">
                    <p class="text-sm">${msg.content}</p>
                </div>
            </div>
        `;
        area.scrollTop = area.scrollHeight;
    },

    async sendMessage() {
        const input = document.getElementById('msg-input');
        if (!input.value.trim() || !activeTicketId) return;

        await supabase.from('messages').insert([{ ticket_id: activeTicketId, content: input.value, sender_type: 'agent' }]);
        input.value = '';
    }
};

const i18n = {
    pt: {
        dashboard: "Painel de Controle",
        queue: "Fila de Atendimento",
        chat: "Atendimento Ativo",
        directory: "Diretório de Agentes",
        logout: "Sair do Sistema",
        search: "Buscar registros...",
        replyPlaceholder: "Digite sua resposta..."
    },
    en: {
        dashboard: "Dashboard",
        queue: "Ticket Queue",
        chat: "Active Chat",
        directory: "Agent Directory",
        logout: "Log Out",
        search: "Search records...",
        replyPlaceholder: "Type your response..."
    },
    es: {
        dashboard: "Panel de Control",
        queue: "Cola de Atención",
        chat: "Chat Activo",
        directory: "Directorio de Agentes",
        logout: "Cerrar Sesión",
        search: "Buscar registros...",
        replyPlaceholder: "Escribe tu respuesta..."
    }
};

// Define o idioma atual do usuário logado (padrão: PT)
let currentLang = 'pt';

function changeLanguage(lang) {
    currentLang = lang;
    
    // Exemplo de como aplicar a tradução na UI
    document.querySelector('[data-target="dashboard"]').childNodes[1].nodeValue = " " + i18n[lang].dashboard;
    document.querySelector('[data-target="queue"]').childNodes[1].nodeValue = " " + i18n[lang].queue;
    // (Aplica a lógica para os demais elementos com base em IDs ou classes)
}

// Start
App.init();