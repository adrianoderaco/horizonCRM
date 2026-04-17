async function listPersonnel() {
    const { data: agents, error } = await supabase
        .from('profiles')
        .select('*')
        .order('full_name', { ascending: true });

    const tableBody = document.querySelector('#agents-table-body');
    tableBody.innerHTML = agents.map(agent => `
        <tr class="group hover:bg-surface-container-lowest transition-all">
            <td class="px-8 py-5">
                <div class="flex items-center gap-3">
                    <div class="h-10 w-10 rounded-lg bg-slate-200 overflow-hidden">
                        <img src="${agent.avatar_url || 'default-avatar.png'}" />
                    </div>
                    <div>
                        <div class="text-body-md font-bold">${agent.full_name}</div>
                        <div class="text-label-sm opacity-60">${agent.email}</div>
                    </div>
                </div>
            </td>
            <td class="px-4 py-5">${agent.role}</td>
            <td class="px-4 py-5">${agent.department}</td>
            <td class="px-4 py-5">
                <span class="px-2 py-1 rounded-full ${agent.status === 'Online' ? 'bg-green-100 text-green-700' : 'bg-slate-200'} text-[10px] font-bold">
                    ${agent.status}
                </span>
            </td>
        </tr>
    `).join('');
}