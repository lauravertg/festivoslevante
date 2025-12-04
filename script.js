// Asegúrate de que las funciones de Firebase están disponibles globalmente (ver index.html)
const {
    initializeApp, getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged,
    getFirestore, doc, setDoc, onSnapshot, collection, addDoc, deleteDoc
} = window.firebase;

// --- Configuración y Estado Global ---
const APP_ID = 'default-app-id'; // Reemplaza con tu ID real
const FIREBASE_CONFIG = {}; // Reemplaza con tu objeto de configuración de Firebase real
const INITIAL_AUTH_TOKEN = undefined;

let app, db, auth;

// Mapeo para mostrar el estado en español
const statusMap = {
    'Pending': 'Pendiente',
    'Approved': 'Aprobada',
    'Rejected': 'Rechazada',
};

// --- Variables de Estado (Sustituyen a Signals) ---
let view = 'dashboard';
let isAuthReady = false;
let user = null;
let userId = 'anonymous';

// Datos de la aplicación
let availableDays = 0;
let vacationRequests = [];
let holidays = [];
let isSaving = false;
let errorMessage = '';

// Propiedades de la vista/formulario
let tempAvailableDays = 0;
let tempHolidayName = '';
let tempHolidayDate = '';
let startDate = '';
let endDate = '';

// --- Lógica de Estado Derivado (Sustituye a Computed Signals) ---

function getApprovedDays() {
    return vacationRequests
        .filter(r => r.status === 'Approved')
        .reduce((sum, r) => sum + r.days, 0);
}

function getPendingDays() {
    return vacationRequests
        .filter(r => r.status === 'Pending')
        .reduce((sum, r) => sum + r.days, 0);
}

function getRemainingDays() {
    return availableDays - getApprovedDays() - getPendingDays();
}

function getSortedRequests() {
    return [...vacationRequests].sort((a, b) => 
        new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
    );
}

function getCalculatedDays() {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const holidayDates = new Set(holidays.map(h => h.date));

    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
        // Validación: Si el error existía, lo limpia si las fechas están limpias.
        if (startDate === '' || endDate === '') errorMessage = '';
        return 0;
    }

    let count = 0;
    let current = new Date(start);

    while (current <= end) {
        const dayOfWeek = current.getDay();
        // 0 = Domingo, 6 = Sábado. Contamos Lunes (1) a Viernes (5)
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
            const dateString = current.toISOString().split('T')[0];
            
            // Descuenta si es un día festivo
            if (!holidayDates.has(dateString)) {
                count++;
            }
        }
        current.setDate(current.getDate() + 1);
    }
    
    // Lógica de error para días laborables
    if (count === 0 && start <= end) {
        errorMessage = 'Las fechas no contienen días laborables disponibles (podrían ser festivos, fines de semana, o el rango no es válido).';
    } else if (count > 0 && errorMessage.includes('días laborables disponibles')) {
        errorMessage = '';
    }

    return count;
}

// --- Renderizado y Manipulación del DOM (Sustituye a la Plantilla Angular) ---

function renderUI() {
    // 1. Mostrar/Ocultar Cargador
    document.getElementById('loading-indicator').style.display = isAuthReady ? 'none' : 'block';
    document.getElementById('main-content').style.display = isAuthReady ? 'block' : 'none';

    if (!isAuthReady) return;

    // 2. Renderizar Header/Navegación
    const headerContainer = document.getElementById('header-container');
    headerContainer.innerHTML = `
        <h1 class="text-3xl font-extrabold text-blue-600 dark:text-blue-400">
            Gestor de Vacaciones
        </h1>
        <div class="flex space-x-2">
            <button id="btn-view-dashboard"
                class="px-4 py-2 rounded-lg font-semibold text-sm transition duration-150 shadow-md ${view === 'dashboard' ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-gray-300 hover:bg-gray-400 text-gray-800'}"
            >
                Solicitudes
            </button>
            <button id="btn-view-config"
                class="px-4 py-2 rounded-lg font-semibold text-sm transition duration-150 shadow-md ${view === 'config' ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-gray-300 hover:bg-gray-400 text-gray-800'}"
            >
                Configuración
            </button>
        </div>
    `;

    // 3. Renderizar Contenido Principal
    const mainContent = document.getElementById('main-content');
    let contentHTML = '';

    if (view === 'dashboard') {
        contentHTML = renderDashboard();
    } else if (view === 'config') {
        contentHTML = renderConfig();
    }
    mainContent.innerHTML = contentHTML;

    // 4. Configurar Event Listeners dinámicamente
    attachEventListeners();
}

function renderDashboard() {
    const remaining = getRemainingDays();
    const approved = getApprovedDays();
    const pending = getPendingDays();
    const calculated = getCalculatedDays();

    // Lógica de deshabilitación del botón de solicitud
    const disableRequest = calculated === 0 || calculated > remaining || isSaving;
    const requestButtonClass = `w-full py-3 px-4 bg-blue-600 text-white font-semibold rounded-xl shadow-lg hover:bg-blue-700 transition duration-150 ${disableRequest ? 'opacity-50 cursor-not-allowed' : ''}`;
    
    // Lógica de error
    let errorHTML = '';
    if (errorMessage) {
        errorHTML = `<p class="text-red-600 text-sm font-semibold p-2 bg-red-100 dark:bg-red-900 rounded-lg">${errorMessage}</p>`;
    }
    let remainingErrorHTML = '';
    if (!isSaving && calculated > remaining) {
        remainingErrorHTML = `<p class="text-orange-600 text-sm mt-2">No tienes suficientes días disponibles (${remaining} restantes).</p>`;
    }


    const requestsListHTML = getSortedRequests().map(request => {
        let statusClasses = '';
        let statusText = statusMap[request.status];

        switch (request.status) {
            case 'Approved':
                statusClasses = 'bg-green-50 dark:bg-green-900/30 border-l-4 border-green-500';
                statusTextClasses = 'text-green-700 dark:text-green-300 bg-green-200/50 dark:bg-green-800/50';
                break;
            case 'Pending':
                statusClasses = 'bg-yellow-50 dark:bg-yellow-900/30 border-l-4 border-yellow-500';
                statusTextClasses = 'text-yellow-700 dark:text-yellow-300 bg-yellow-200/50 dark:bg-yellow-800/50';
                break;
            case 'Rejected':
                statusClasses = 'bg-red-50 dark:bg-red-900/30 border-l-4 border-red-500';
                statusTextClasses = 'text-red-700 dark:text-red-300 bg-red-200/50 dark:bg-red-800/50';
                break;
            default:
                statusClasses = 'bg-white dark:bg-gray-800';
                statusTextClasses = 'text-gray-700 dark:text-gray-300 bg-gray-200/50 dark:bg-gray-700/50';
        }

        const cancelButton = request.status === 'Pending' 
            ? `<button data-id="${request.id}" class="btn-delete-request ml-2 text-red-500 hover:text-red-700 transition duration-150 text-xs font-medium">Cancelar</button>`
            : '';

        return `
            <div class="p-4 rounded-xl shadow-md transition duration-150 ${statusClasses}">
                <div class="flex justify-between items-start">
                    <div>
                        <p class="text-lg font-semibold text-gray-800 dark:text-gray-100">
                            ${request.startDate} - ${request.endDate}
                        </p>
                        <p class="text-sm text-gray-600 dark:text-gray-400 mt-1">
                            ${request.days} días laborables.
                        </p>
                    </div>
                    <div class="text-right">
                        <span class="inline-block px-3 py-1 text-xs font-bold rounded-full ${statusTextClasses}">
                            ${statusText}
                        </span>
                        ${cancelButton}
                    </div>
                </div>
            </div>
        `;
    }).join('');

    const emptyRequestsHTML = `
        <div class="text-center p-6 text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 rounded-xl">
            Aún no has solicitado vacaciones. ¡Comienza ahora!
        </div>
    `;

    return `
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div class="lg:col-span-1 space-y-8">
                
                <div class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-xl border-t-4 border-blue-500">
                    <h2 class="text-2xl font-bold mb-4 text-gray-800 dark:text-gray-100">Resumen de Días</h2>
                    <div class="flex justify-between items-center text-lg font-medium">
                        <span class="text-gray-600 dark:text-gray-400">Días Disponibles:</span>
                        <span class="text-blue-600 dark:text-blue-400 font-extrabold">${availableDays}</span>
                    </div>
                    <div class="flex justify-between items-center text-lg font-medium mt-2">
                        <span class="text-gray-600 dark:text-gray-400">Días Pendientes:</span>
                        <span class="text-yellow-600 dark:text-yellow-400 font-extrabold">${pending}</span>
                    </div>
                    <div class="flex justify-between items-center text-lg font-medium mt-2">
                        <span class="text-gray-600 dark:text-gray-400">Días Consumidos:</span>
                        <span class="text-green-600 dark:text-green-400 font-extrabold">${approved}</span>
                    </div>
                    <div class="mt-4 text-sm text-gray-500 dark:text-gray-400">
                        <p>Tu ID de Usuario (para referencia):</p>
                        <p class="truncate font-mono bg-gray-100 dark:bg-gray-700 p-2 rounded-md mt-1">${userId}</p>
                    </div>
                </div>

                <div class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-xl">
                    <h2 class="text-2xl font-bold mb-6 text-gray-800 dark:text-gray-100">Solicitar Vacaciones</h2>
                    <div class="space-y-4">
                        <div class="flex flex-col">
                            <label for="start" class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Fecha de Inicio</label>
                            <input type="date" id="start-date" value="${startDate}" class="form-input rounded-lg border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white" required>
                        </div>
                        <div class="flex flex-col">
                            <label for="end" class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Fecha de Fin</label>
                            <input type="date" id="end-date" value="${endDate}" class="form-input rounded-lg border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white" required>
                        </div>
                        <div class="p-3 bg-blue-50 dark:bg-blue-900/50 rounded-lg text-sm font-medium">
                            Días solicitados: <span id="calculated-days" class="font-bold text-blue-700 dark:text-blue-300">${calculated} días laborables</span>
                        </div>
                        ${errorHTML}
                        <button id="btn-request-vacation" ${disableRequest ? 'disabled' : ''} class="${requestButtonClass}">
                            ${isSaving ? 'Enviando...' : 'Enviar Solicitud'}
                        </button>
                        ${remainingErrorHTML}
                    </div>
                </div>
            </div>

            <div class="lg:col-span-2">
                <h2 class="text-2xl font-bold mb-4 text-gray-800 dark:text-gray-100">
                    Historial de Solicitudes (${vacationRequests.length})
                </h2>
                <div class="space-y-4">
                    ${vacationRequests.length > 0 ? requestsListHTML : emptyRequestsHTML}
                </div>
            </div>
        </div>
    `;
}

function renderConfig() {
    const disableSave = isSaving;
    const saveButtonClass = `w-full py-3 px-4 bg-blue-600 text-white font-semibold rounded-xl shadow-lg hover:bg-blue-700 transition duration-150 ${disableSave ? 'opacity-50 cursor-not-allowed' : ''}`;
    const disableAddHoliday = !tempHolidayName || !tempHolidayDate || isSaving;
    const addHolidayButtonClass = `w-full py-3 px-4 bg-indigo-600 text-white font-semibold rounded-xl shadow-lg hover:bg-indigo-700 transition duration-150 ${disableAddHoliday ? 'opacity-50 cursor-not-allowed' : ''}`;


    const holidaysListHTML = holidays.map(holiday => `
        <li class="flex justify-between items-center p-3 bg-indigo-50 dark:bg-indigo-900/50 rounded-lg">
            <span class="font-medium text-gray-700 dark:text-gray-200">${holiday.name}</span>
            <div class="flex items-center">
                <span class="text-sm text-indigo-600 dark:text-indigo-300 mr-4">${holiday.date}</span>
                <button data-date="${holiday.date}" class="btn-delete-holiday text-red-500 hover:text-red-700 transition duration-150 text-sm font-medium">
                    Eliminar
                </button>
            </div>
        </li>
    `).join('');

    const emptyHolidaysHTML = '<p class="text-gray-500 dark:text-gray-400 italic">No hay días festivos configurados.</p>';

    return `
        <div class="grid grid-cols-1 gap-8 max-w-xl mx-auto">
            <div class="bg-white dark:bg-gray-800 p-8 rounded-xl shadow-2xl border-t-4 border-blue-500">
                <h2 class="text-2xl font-bold mb-6 text-gray-800 dark:text-gray-100 border-b pb-3 border-gray-200 dark:border-gray-700">
                    Total de Días Anuales
                </h2>
                
                <div class="space-y-6">
                    <div class="flex flex-col">
                        <label for="annualDays" class="text-lg font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Días de Vacaciones Asignados
                        </label>
                        <input type="number" id="input-annual-days"
                                value="${tempAvailableDays}"
                                min="0"
                                class="form-input rounded-lg border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white text-xl p-3"
                                placeholder="Ej: 22">
                        <p class="text-sm text-gray-500 dark:text-gray-400 mt-2">
                            Define el número total de días laborables que tienes asignados.
                        </p>
                    </div>

                    <button id="btn-save-days" ${disableSave ? 'disabled' : ''} class="${saveButtonClass}">
                        ${isSaving ? 'Guardando...' : 'Guardar Días Anuales'}
                    </button>
                </div>
            </div>

            <div class="bg-white dark:bg-gray-800 p-8 rounded-xl shadow-2xl border-t-4 border-indigo-500">
                <h2 class="text-2xl font-bold mb-6 text-gray-800 dark:text-gray-100 border-b pb-3 border-gray-200 dark:border-gray-700">
                    Gestión de Días Festivos
                </h2>
                
                <div class="space-y-4 mb-6">
                    <div class="flex flex-col">
                        <label for="holidayName" class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nombre del Festivo</label>
                        <input type="text" id="input-holiday-name" value="${tempHolidayName}" class="form-input rounded-lg border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white" placeholder="Ej: Navidad">
                    </div>
                    <div class="flex flex-col">
                        <label for="holidayDate" class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Fecha</label>
                        <input type="date" id="input-holiday-date" value="${tempHolidayDate}" class="form-input rounded-lg border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white" required>
                    </div>
                    <button id="btn-add-holiday" ${disableAddHoliday ? 'disabled' : ''} class="${addHolidayButtonClass}">
                        Añadir Día Festivo
                    </button>
                </div>

                <h3 class="text-xl font-bold text-gray-800 dark:text-gray-100 mb-4 border-b pb-2">
                    Festivos Actuales (${holidays.length})
                </h3>
                
                <ul class="space-y-2">
                    ${holidays.length > 0 ? holidaysListHTML : emptyHolidaysHTML}
                </ul>
            </div>
        </div>
    `;
}

// --- Enlace de Eventos del DOM (Sustituye a (click) y [(ngModel)]) ---

function attachEventListeners() {
    // Navegación
    document.getElementById('btn-view-dashboard')?.addEventListener('click', () => {
        view = 'dashboard';
        renderUI();
    });
    document.getElementById('btn-view-config')?.addEventListener('click', () => {
        view = 'config';
        // Sincronizar tempAvailableDays al entrar en configuración
        tempAvailableDays = availableDays;
        renderUI();
    });

    // Formulario de Solicitud (Dashboard)
    const startDateInput = document.getElementById('start-date');
    const endDateInput = document.getElementById('end-date');
    
    if (startDateInput && endDateInput) {
        // Enlace bidireccional (ngModel) y actualización de días calculados
        const updateDates = () => {
            startDate = startDateInput.value;
            endDate = endDateInput.value;
            // Se actualiza el DOM directamente para el span de días y se re-renderiza todo el dashboard
            document.getElementById('calculated-days').textContent = `${getCalculatedDays()} días laborables`;
            renderUI(); 
        };
        startDateInput.addEventListener('input', updateDates);
        endDateInput.addEventListener('input', updateDates);

        // Envío de solicitud
        document.getElementById('btn-request-vacation')?.addEventListener('click', requestVacation);
    }
    
    // Botones de Cancelar Solicitud
    document.querySelectorAll('.btn-delete-request').forEach(btn => {
        btn.addEventListener('click', (event) => {
            const id = event.target.dataset.id;
            // No usamos window.confirm() para ser fieles a la nota del código original
            if (id) deleteRequest(id);
        });
    });


    // Formulario de Configuración (Config)
    const annualDaysInput = document.getElementById('input-annual-days');
    if (annualDaysInput) {
        annualDaysInput.addEventListener('input', (event) => {
            tempAvailableDays = Number(event.target.value);
        });
        document.getElementById('btn-save-days')?.addEventListener('click', saveDaysSettings);
    }

    // Formulario de Días Festivos
    const holidayNameInput = document.getElementById('input-holiday-name');
    const holidayDateInput = document.getElementById('input-holiday-date');

    if (holidayNameInput && holidayDateInput) {
        holidayNameInput.addEventListener('input', (event) => {
            tempHolidayName = event.target.value;
            // Re-renderizar para actualizar el estado del botón Añadir
            renderUI();
        });
        holidayDateInput.addEventListener('input', (event) => {
            tempHolidayDate = event.target.value;
            // Re-renderizar para actualizar el estado del botón Añadir
            renderUI();
        });
        document.getElementById('btn-add-holiday')?.addEventListener('click', addHoliday);
    }

    // Botones de Eliminar Festivo
    document.querySelectorAll('.btn-delete-holiday').forEach(btn => {
        btn.addEventListener('click', (event) => {
            const date = event.target.dataset.date;
            if (date) deleteHoliday(date);
        });
    });
}

// --- Lógica de Firebase (Adaptación a JS Nativo) ---

async function initFirebase() {
    try {
        app = initializeApp(FIREBASE_CONFIG);
        db = getFirestore(app);
        auth = getAuth(app);
        
        onAuthStateChanged(auth, async (userObj) => {
            if (userObj) {
                user = userObj;
            } else {
                if (INITIAL_AUTH_TOKEN) {
                    await signInWithCustomToken(auth, INITIAL_AUTH_TOKEN);
                } else {
                    await signInAnonymously(auth);
                }
                user = auth.currentUser;
            }

            userId = user?.uid || 'anonymous';
            isAuthReady = true;
            renderUI();

            if (user) {
                loadInitialData();
            }
        });

    } catch (e) {
        console.error("Error al inicializar Firebase:", e);
        isAuthReady = true;
        errorMessage = 'Error crítico: No se pudo conectar con la base de datos.';
        renderUI();
    }
}

function loadInitialData() {
    if (!userId || !db) return;

    // 1. Cargar Días Disponibles (Settings)
    const settingsDocRef = doc(db, `artifacts/${APP_ID}/users/${userId}/settings/days`);
    onSnapshot(settingsDocRef, (docSnapshot) => {
        const data = docSnapshot.data();
        availableDays = data?.availableDays || 22;
        // Sustituye el "effect" de Angular: forzamos el re-renderizado
        tempAvailableDays = availableDays; 
        renderUI();
    }, (error) => {
        console.error("Error al cargar settings:", error);
    });

    // 2. Cargar Solicitudes de Vacaciones
    const requestsCollectionRef = collection(db, `artifacts/${APP_ID}/users/${userId}/vacation_requests`);
    onSnapshot(requestsCollectionRef, (snapshot) => {
        vacationRequests = [];
        snapshot.forEach(doc => {
            vacationRequests.push({ id: doc.id, ...doc.data() });
        });
        // Sustituye el "effect" de Angular: forzamos el re-renderizado
        renderUI();
    }, (error) => {
        console.error("Error al cargar solicitudes:", error);
    });

    // 3. Cargar Días Festivos
    const holidaysCollectionRef = collection(db, `artifacts/${APP_ID}/users/${userId}/holidays`);
    onSnapshot(holidaysCollectionRef, (snapshot) => {
        holidays = [];
        snapshot.forEach(doc => {
            holidays.push({ ...doc.data() });
        });
        // Ordenar por fecha
        holidays.sort((a, b) => a.date.localeCompare(b.date));
        // Sustituye el "effect" de Angular: forzamos el re-renderizado
        renderUI();
    }, (error) => {
        console.error("Error al cargar festivos:", error);
    });
}

// --- Lógica del Dashboard (Solicitudes) ---

async function requestVacation() {
    errorMessage = '';

    const daysRequested = getCalculatedDays();
    const remaining = getRemainingDays();

    if (daysRequested === 0) {
        errorMessage = 'Por favor, selecciona un rango de fechas válido con días laborables.';
        renderUI();
        return;
    }
    if (daysRequested > remaining) {
        errorMessage = `Solicitud excede los días restantes (${remaining}).`;
        renderUI();
        return;
    }

    isSaving = true;
    renderUI();

    try {
        const newRequest = {
            startDate: startDate,
            endDate: endDate,
            days: daysRequested,
            status: 'Pending',
            requestedOn: new Date().toISOString().split('T')[0],
        };

        const requestsCollectionRef = collection(db, `artifacts/${APP_ID}/users/${userId}/vacation_requests`);
        await addDoc(requestsCollectionRef, newRequest);

        // Limpiar formulario y error
        startDate = '';
        endDate = '';
        errorMessage = '';
        
        // La actualización de requests se hace en el onSnapshot, pero actualizamos el estado local
        const startInput = document.getElementById('start-date');
        const endInput = document.getElementById('end-date');
        if (startInput) startInput.value = '';
        if (endInput) endInput.value = '';

    } catch (e) {
        console.error("Error al enviar solicitud:", e);
        errorMessage = 'Error al guardar la solicitud. Inténtalo de nuevo.';
    } finally {
        isSaving = false;
        renderUI();
    }
}

async function deleteRequest(requestId) {
    try {
        const requestRef = doc(db, `artifacts/${APP_ID}/users/${userId}/vacation_requests/${requestId}`);
        await deleteDoc(requestRef);
    } catch (e) {
        console.error("Error al cancelar solicitud:", e);
        errorMessage = 'Error al cancelar la solicitud.';
        renderUI();
    }
}

// --- Lógica de Configuración (Días Anuales) ---

async function saveDaysSettings() {
    errorMessage = '';
    isSaving = true;
    renderUI();

    const daysToSave = Math.max(0, Math.floor(tempAvailableDays));
    
    try {
        const settingsDocRef = doc(db, `artifacts/${APP_ID}/users/${userId}/settings/days`);
        const settings = { availableDays: daysToSave };
        
        await setDoc(settingsDocRef, settings, { merge: true });
        availableDays = daysToSave; // onSnapshot también lo actualizará, pero lo hacemos localmente por si acaso
        view = 'dashboard';
        
    } catch (e) {
        console.error("Error al guardar configuración:", e);
        errorMessage = 'Error al guardar la configuración de días.';
    } finally {
        isSaving = false;
        renderUI();
    }
}

// --- Lógica de Configuración (Festivos) ---

async function addHoliday() {
    errorMessage = '';
    if (!tempHolidayName || !tempHolidayDate) return;

    isSaving = true;
    renderUI();

    try {
        const holidayData = { 
            name: tempHolidayName, 
            date: tempHolidayDate 
        };
        
        const holidayDocRef = doc(db, `artifacts/${APP_ID}/users/${userId}/holidays/${tempHolidayDate}`);
        await setDoc(holidayDocRef, holidayData);

        // Limpiar formulario
        tempHolidayName = '';
        tempHolidayDate = '';
        
        // Actualizar valores de los inputs en el DOM (ya que el re-renderizado no ocurrirá hasta que onSnapshot devuelva)
        document.getElementById('input-holiday-name').value = '';
        document.getElementById('input-holiday-date').value = '';

    } catch (e) {
        console.error("Error al añadir festivo:", e);
        errorMessage = 'Error al guardar el día festivo.';
    } finally {
        isSaving = false;
        renderUI();
    }
}

async function deleteHoliday(date) {
    errorMessage = '';

    try {
        const holidayDocRef = doc(db, `artifacts/${APP_ID}/users/${userId}/holidays/${date}`);
        await deleteDoc(holidayDocRef);
    } catch (e) {
        console.error("Error al eliminar festivo:", e);
        errorMessage = 'Error al eliminar el día festivo.';
        renderUI();
    }
}


// --- Inicialización ---
document.addEventListener('DOMContentLoaded', () => {
    // Primera llamada a renderUI para mostrar el cargador
    renderUI();
    // Inicializar la aplicación
    initFirebase();
});