async function loadQueue() {
    const contentArea = document.getElementById('content-area');
    contentArea.innerHTML = '<h2 class="text-2xl font-bold mb-6">Fila de Atendimento</h2><div id="queue-list" class="space-y-4">Carregando...</div>';

    const { data: tickets, error } = await supabase
        .from('tickets')
        .select(`*, customers(full_name, tier)`)
        .eq('status', 'pending');

    const queueList = document.getElementById('queue-list');
    queueList.innerHTML = '';

    if (tickets.length === 0) {
        queueList.innerHTML = '<p class="text-slate-400">Nenhum ticket pendente.</p>';
        return;
    }

    tickets.forEach(ticket => {
        queueList.innerHTML += `
            <div class="bg-slate-800 p-5 rounded-xl border border-slate-700 flex justify-between items-center">
                <div>
                    <h3 class="font-bold text-lg">${ticket.customers.full_name}</h3>
                    <p class="text-sm text-slate-400">${ticket.subject}</p>
                    <span class="text-[10px] bg-blue-900 px-2 py-0.5 rounded">${ticket.customers.tier}</span>
                </div>
                <button onclick="pickUpTicket('${ticket.id}')" class="bg-blue-600 px-4 py-2 rounded-lg font-bold text-sm">Atender</button>
            </div>
        `;
    });
}

async function pickUpTicket(ticketId) {
    const { data: { user } } = await supabase.auth.getUser();
    
    // Atualiza o ticket para 'active' e atribui ao agente
    await supabase
        .from('tickets')
        .update({ status: 'active', assigned_to: user.id })
        .eq('id', ticketId);

    alert("Ticket capturado! Agora ele aparecerá em 'Meus Atendimentos'.");
    loadQueue();
}

// Função para carregar a interface de chat
async function openChat(ticketId) {
    const contentArea = document.getElementById('content-area');
    contentArea.innerHTML = `
        <div class="flex flex-col h-full bg-slate-900 rounded-xl overflow-hidden border border-slate-800">
            <div class="p-4 bg-slate-800 border-b border-slate-700 flex justify-between items-center">
                <h3 class="font-bold" id="chat-customer-name">Carregando conversa...</h3>
                <button onclick="loadQueue()" class="text-xs text-slate-400 hover:text-white">Voltar para Fila</button>
            </div>
            
            <div id="messages-container" class="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-hide">
                </div>

            <div class="p-4 bg-slate-800 border-t border-slate-700">
                <form id="chat-form" class="flex gap-3">
                    <input type="text" id="message-input" placeholder="Digite sua resposta..." 
                           class="flex-1 bg-slate-700 border-none rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <button type="submit" class="bg-blue-600 px-6 py-2 rounded-lg font-bold transition hover:bg-blue-500">Enviar</button>
                </form>
            </div>
        </div>
    `;

    setupChatRealtime(ticketId);
    loadMessages(ticketId);

    // Evento de envio
    document.getElementById('chat-form').onsubmit = async (e) => {
        e.preventDefault();
        const input = document.getElementById('message-input');
        if (!input.value.trim()) return;
        
        await sendMessage(ticketId, input.value);
        input.value = '';
    };
}

// 1. Buscar mensagens existentes
async function loadMessages(ticketId) {
    const { data: messages, error } = await supabase
        .from('messages')
        .select('*')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: true });

    const container = document.getElementById('messages-container');
    container.innerHTML = '';
    messages.forEach(msg => appendMessage(msg));
    container.scrollTop = container.scrollHeight;
}

// 2. Adicionar mensagem na tela (Estilo Bolha)
function appendMessage(msg) {
    const container = document.getElementById('messages-container');
    const isAgent = msg.sender_type === 'agent';
    
    const messageHtml = `
        <div class="flex ${isAgent ? 'justify-end' : 'justify-start'}">
            <div class="max-w-[80%] p-3 rounded-2xl ${isAgent ? 'bg-blue-600 rounded-tr-none' : 'bg-slate-700 rounded-tl-none'}">
                <p class="text-sm">${msg.content}</p>
                <span class="text-[9px] opacity-50 block mt-1">${new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
            </div>
        </div>
    `;
    container.insertAdjacentHTML('beforeend', messageHtml);
    container.scrollTop = container.scrollHeight;
}

// 3. Enviar nova mensagem
async function sendMessage(ticketId, content) {
    const { data: { user } } = await supabase.auth.getUser();
    
    const { error } = await supabase
        .from('messages')
        .insert([{ 
            ticket_id: ticketId, 
            content: content, 
            sender_id: user.id, 
            sender_type: 'agent' 
        }]);

    if (error) console.error("Erro ao enviar:", error);
}

// 4. ESCUTA EM TEMPO REAL (O segredo do Chat)
function setupChatRealtime(ticketId) {
    supabase
        .channel(`chat:${ticketId}`)
        .on('postgres_changes', { 
            event: 'INSERT', 
            schema: 'public', 
            table: 'messages', 
            filter: `ticket_id=eq.${ticketId}` 
        }, payload => {
            appendMessage(payload.new);
        })
        .subscribe();
}