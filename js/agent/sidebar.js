// Arquivo: js/agent/sidebar.js

// Arquivo: js/agent/sidebar.js
export const Sidebar = {
    render(containerId, userRole) {
        const container = document.getElementById(containerId);
        if (!container) return;
        const isGestor = userRole === 'gestor';

        container.innerHTML = `
        <aside class="w-64 bg-slate-900 border-r border-slate-800 flex flex-col text-slate-300 z-20 shrink-0 h-full">
            <div class="p-6"><div class="text-2xl font-black text-white tracking-tight flex items-center gap-2"><span class="material-symbols-outlined text-blue-400">cloud</span> Horizon</div></div>
            <nav class="flex-1 px-4 space-y-2 mt-4">
                <button onclick="agentApp.navigate('queue')" class="w-full flex items-center gap-3 px-4 py-3 text-sm font-bold rounded-xl transition-all hover:bg-slate-800"><span class="material-symbols-outlined">confirmation_number</span> Monitor da Fila</button>
                <button id="menu-chat" onclick="agentApp.navigate('chat')" class="hidden-view w-full flex items-center gap-3 px-4 py-3 text-sm font-bold rounded-xl transition-all bg-blue-600 text-white"><span class="material-symbols-outlined">forum</span> Chat Ativo</button>
                <div class="h-px bg-slate-800 my-4"></div>
                ${isGestor ? `
                <button onclick="agentApp.navigate('team')" class="w-full flex items-center gap-3 px-4 py-3 text-sm font-bold rounded-xl transition-all hover:bg-slate-800"><span class="material-symbols-outlined">groups</span> Gestão de Equipe</button>
                <button onclick="agentApp.navigate('dashboard')" class="w-full flex items-center gap-3 px-4 py-3 text-sm font-bold rounded-xl transition-all hover:bg-slate-800 text-amber-400"><span class="material-symbols-outlined">dashboard</span> Dashboard</button>
                ` : ''}
            </nav>
            <div class="p-4 border-t border-slate-800">
                <button onclick="agentApp.logout()" class="w-full py-3 flex items-center gap-3 px-4 text-red-400 font-bold text-sm hover:bg-red-500/10 rounded-xl transition-colors"><span class="material-symbols-outlined">logout</span> Sair / Deslogar</button>
            </div>
        </aside>`;
    }
};