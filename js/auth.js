const supabase = supabase.createClient(CONFIG.URL, CONFIG.KEY);

const loginForm = document.getElementById('login-form');

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
        alert("Erro: " + error.message);
    } else {
        checkSession();
    }
});

async function checkSession() {
    const { data: { session } } = await supabase.auth.getSession();
    const loginScreen = document.getElementById('login-screen');
    const mainApp = document.getElementById('main-app');

    if (session) {
        loginScreen.classList.add('hidden');
        mainApp.classList.remove('hidden');
        loadQueue(); // Carrega a fila ao entrar
    } else {
        loginScreen.classList.remove('hidden');
        mainApp.classList.add('hidden');
    }
}

async function handleLogout() {
    await supabase.auth.signOut();
    checkSession();
}

// Inicia checando se já está logado
checkSession();