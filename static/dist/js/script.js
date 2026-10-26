// Crée un nouveau bloc de message à partir du modèle HTML caché.
function createMessageElement() {
    // Récupère le conteneur qui affiche les messages de la conversation.
    const output = document.querySelector("#gpt-output");

    // Récupère le bloc HTML utilisé comme modèle.
    const template = document.querySelector("#chat-template");

    // Copie le modèle avec tous ses éléments enfants.
    const clone = template.cloneNode(true);

    // Retire l’identifiant du clone pour éviter les identifiants en double.
    clone.id = "";

    // Ajoute le nouveau bloc à la fin de la conversation.
    output.appendChild(clone);
    output.scrollTop = output.scrollHeight;

    // Retire la classe Tailwind "hidden" pour rendre le bloc visible.
    clone.classList.remove("hidden");

    // Retourne l’élément qui recevra le texte du message.
    return clone.querySelector(".message");
}

// Ajoute un message à la conversation et retourne son élément HTML.
function appendMessage(message, role = "user") {
    // Crée un bloc visible et récupère son élément ".message".
    const infoBlock = createMessageElement();

    //si _cloneAnswerBlock() retourne null
    // Vérifie que l’élément destiné au message existe.
    if (!infoBlock) {
        // Affiche une erreur dans la console du navigateur.
        console.error("Failed to create the information block");

        // Arrête la fonction en indiquant qu’aucun élément n’est disponible.
        return null;
    }

    if (role === "assistant") {
        const converter = new showdown.Converter({
            tables: true,
            ghCodeBlocks: true,
            simplifiedAutoLink: true,
        });
        infoBlock.innerHTML = DOMPurify.sanitize(converter.makeHtml(message));
    } else {
        // Insère le message utilisateur comme du texte, sans HTML.
        infoBlock.innerText = message;
    }

    infoBlock.parentElement.classList.add(
        role === "assistant" ? "chat-message-assistant" : "chat-message-user"
    );
    infoBlock.parentElement.dataset.roleLabel = role === "assistant" ? "FlaskGPT" : "Vous";

    // Retourne l’élément pour pouvoir modifier son contenu ensuite.
    return infoBlock;
}

// Conserve l’historique conversationnel indépendamment du rendu HTML.
let conversationHistory = [];

function getChatHistory() {
    // Retourne une copie de l’historique, séparé de l’affichage HTML.
    return [...conversationHistory];
}

// Envoie la conversation à Flask et retourne un lecteur de la réponse progressive.
async function fetchPromptResponse(conversationId, sourceIds, passagesPerSource, customDomain) {
    // Envoie une requête à la route Flask "/prompt" et attend sa réponse initiale.
    const response = await fetch("/prompt", {
        // Utilise POST pour transmettre les données au serveur.
        method: "POST",

        // Indique que le corps de la requête contient du JSON.
        headers: {
            "Content-Type": "application/json",
        },

        // Récupère l’historique et le convertit en texte JSON.
        body: JSON.stringify({
            messages: getChatHistory(),
            domain: document.querySelector("#domain").value,
            custom_domain: customDomain,
            conversation_id: conversationId,
            source_ids: sourceIds,
            passages_per_source: passagesPerSource,
        }),
    });

    if (!response.ok) {
        let errorMessage = "Impossible d’envoyer le message.";
        try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
        } catch (error) {
            // Conserve le message générique si la réponse n’est pas du JSON.
        }
        throw new Error(errorMessage);
    }

    // Retourne un lecteur permettant de lire la réponse fragment par fragment.
    return response.body.getReader();
}

// Lit la réponse progressive et affiche le texte converti en HTML.
async function readResponseChunks(reader, gptOutput) {
    // Décode les octets reçus en texte UTF-8.
    const decoder = new TextDecoder("utf-8");

    // Crée le convertisseur Markdown vers HTML.
    const converter = new showdown.Converter({
        tables: true,
        ghCodeBlocks: true,
        simplifiedAutoLink: true,
    });

    // Conserve le texte complet reçu jusqu’à présent.
    let text = "";
    const scrollContainer = gptOutput.closest("#gpt-output");

    try {
        while (true) {
            // Attend le prochain fragment.
            // done indique la fin du flux ; value contient les octets reçus.
            const { done, value } = await reader.read();

            // Quitte la boucle lorsque le flux est terminé.
            if (done) break;

            // Décode le fragment en conservant les caractères incomplets
            // pour les compléter lors de la réception suivante.
            text += decoder.decode(value, { stream: true });

            // Convertit le Markdown en HTML et sécurise le résultat.
            gptOutput.innerHTML = DOMPurify.sanitize(
                converter.makeHtml(text)
            );
            if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight;
        }

        // Termine le décodage des éventuels octets restants.
        text += decoder.decode();

        if (
            text.includes("\n\n> **Erreur de connexion") ||
            text.includes("\n\n> **La g\u00e9n\u00e9ration a \u00e9t\u00e9 interrompue")
        ) {
            throw new Error("Le flux Groq s'est interrompu avant la fin de la réponse.");
        }
        if (!text.trim()) {
            throw new Error("Groq a renvoyé une réponse vide. Réessayez.");
        }

        // Affiche le résultat final.
        gptOutput.innerHTML = DOMPurify.sanitize(
            converter.makeHtml(text)
        );
        if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight;
        if (window.hljs) {
            gptOutput.querySelectorAll("pre code").forEach((codeBlock) => {
                window.hljs.highlightElement(codeBlock);
            });
        }
    } finally {
        // Libère le lecteur, même si une erreur survient.
        reader.releaseLock();
    }

    return text;
}

// Attend que le HTML soit chargé avant d’exécuter ce code.
document.addEventListener("DOMContentLoaded", () => {
    // Récupère le formulaire grâce à son identifiant.
    const form = document.querySelector("#prompt-form");

    // Récupère le bouton situé dans le formulaire.
    const button = form.querySelector('button[type="submit"]');
    const promptInput = form.elements.prompt;
    const clearPromptButton = document.querySelector("#clear-prompt");
    const promptCounter = document.querySelector("#prompt-counter");
    const newChatButton = document.querySelector("#new-chat-button");
    const newChatDialog = document.querySelector("#new-chat-dialog");
    const cancelNewChatButton = document.querySelector("#cancel-new-chat");
    const confirmNewChatButton = document.querySelector("#confirm-new-chat");
    const gptOutput = document.querySelector("#gpt-output");
    const domainSelect = document.querySelector("#domain");
    const domainHint = document.querySelector("#domain-hint");
    const customDomainField = document.querySelector("#custom-domain-field");
    const customDomainInput = document.querySelector("#custom-domain");
    const conversationList = document.querySelector("#conversation-list");
    const historyConversationList = document.querySelector("#history-conversation-list");
    const emptyConversations = document.querySelector("#empty-conversations");
    const historyEmpty = document.querySelector("#history-empty");
    const conversationCount = document.querySelector("#conversation-count");
    const chatError = document.querySelector("#chat-error");
    const exportConversationButton = document.querySelector("#export-conversation-button");
    const exportConversationLabel = document.querySelector("#export-conversation-label");
    const exportFormat = document.querySelector("#export-format");
    const exportPdfButton = document.querySelector("#export-pdf-button");
    const exportPdfLabel = document.querySelector("#export-pdf-label");
    const dataQualityForm = document.querySelector("#data-quality-form");
    const datasetFileInput = document.querySelector("#dataset-file");
    const dataTablePicker = document.querySelector("#data-table-picker");
    const dataTableSelect = document.querySelector("#data-table");
    const analyzeDataButton = document.querySelector("#analyze-data-button");
    const analyzeDataLabel = document.querySelector("#analyze-data-label");
    const dataQualityError = document.querySelector("#data-quality-error");
    const dataQualityReport = document.querySelector("#data-quality-report");
    const performanceCards = document.querySelector("#performance-cards");
    const performanceConversations = document.querySelector("#performance-conversations");
    const performanceRequests = document.querySelector("#performance-requests");
    const performanceError = document.querySelector("#performance-error");
    const performanceScope = document.querySelector("#performance-scope");
    const performanceRequestsTitle = document.querySelector("#performance-requests-title");
    const performanceDomains = document.querySelector("#performance-domains");
    const dashboardDomainComparison = document.querySelector("#dashboard-domain-comparison");
    const dashboardConversationCount = document.querySelector("#dashboard-conversations");
    const dashboardCompleted = document.querySelector("#dashboard-completed");
    const dashboardFailed = document.querySelector("#dashboard-failed");
    const dashboardLatency = document.querySelector("#dashboard-latency");
    const dashboardTokens = document.querySelector("#dashboard-tokens");
    const dashboardTokenDetail = document.querySelector("#dashboard-token-detail");
    const dashboardRating = document.querySelector("#dashboard-rating");
    const dashboardRatingDetail = document.querySelector("#dashboard-rating-detail");
    const dashboardLatencyChart = document.querySelector("#dashboard-latency-chart");
    const dashboardLatencyEmpty = document.querySelector("#dashboard-latency-empty");
    const dashboardLatencySummary = document.querySelector("#dashboard-latency-summary");
    const dashboardTokenChart = document.querySelector("#dashboard-token-chart");
    const dashboardTokenEmpty = document.querySelector("#dashboard-token-empty");
    const dashboardRecentConversations = document.querySelector("#dashboard-recent-conversations");
    const dashboardConversationsEmpty = document.querySelector("#dashboard-conversations-empty");
    const dashboardRecentRatings = document.querySelector("#dashboard-recent-ratings");
    const dashboardRatingsEmpty = document.querySelector("#dashboard-ratings-empty");
    const dashboardQualitySummary = document.querySelector("#dashboard-quality-summary");
    const dashboardQualityEmpty = document.querySelector("#dashboard-quality-empty");
    const dashboardError = document.querySelector("#dashboard-error");
    const dashboardRefreshButton = document.querySelector("#dashboard-refresh");
    const ratingsRecentList = document.querySelector("#ratings-recent-list");
    const ratingsRecentEmpty = document.querySelector("#ratings-recent-empty");
    const latencyChart = document.querySelector("#latency-chart");
    const latencyChartEmpty = document.querySelector("#latency-chart-empty");
    const latencyChartSummary = document.querySelector("#latency-chart-summary");
    const refreshPerformanceButton = document.querySelector("#refresh-performance");
    const ratingTotal = document.querySelector("#rating-total");
    const ratingCountElements = {
        satisfaisante: document.querySelector("#rating-count-satisfaisante"),
        moyenne: document.querySelector("#rating-count-moyenne"),
        insuffisante: document.querySelector("#rating-count-insuffisante"),
    };
    const generationStatus = document.querySelector("#generation-status");
    const chatErrorMessage = document.querySelector("#chat-error-message");
    const retryLastPromptButton = document.querySelector("#retry-last-prompt");
    const mobileNavToggle = document.querySelector("#mobile-nav-toggle");
    const closeSidebarButton = document.querySelector("#close-sidebar");
    const sidebarOverlay = document.querySelector("#sidebar-overlay");
    const appSidebar = document.querySelector("#app-sidebar");
    const themeToggle = document.querySelector("#theme-toggle");
    const themeToggleIcon = document.querySelector("#theme-toggle-icon");
    const pageHeading = document.querySelector("#page-heading");
    const pageDescription = document.querySelector("#page-description");
    const sidebarLinks = [...document.querySelectorAll(".sidebar-link[data-view-target]")];
    const viewPanels = [...document.querySelectorAll("[data-view-panel]")];
    const assistantActions = [...document.querySelectorAll(".assistant-only")];
    let lastFailedRequest = null;
    const sourcesUploadForm = document.querySelector("#sources-upload-form");
    const sourceFilesInput = document.querySelector("#source-files");
    const uploadSourcesButton = document.querySelector("#upload-sources-button");
    const sourceList = document.querySelector("#source-list");
    const emptySources = document.querySelector("#empty-sources");
    const sourcesStatus = document.querySelector("#sources-status");
    const passagesPerSourceSelect = document.querySelector("#passages-per-source");
    const selectedSourceIds = new Set();
    let activeConversationId = null;
    let requestInProgress = false;
    let exportInProgress = false;

    const viewLabels = {
        dashboard: ["Tableau de bord", "Vue synthetique de votre activite FlaskGPT."],
        assistant: ["Assistant IA", "Posez une question dans le domaine de votre choix."],
        history: ["Historique des conversations", "Retrouvez et reprenez vos conversations enregistrees."],
        sources: ["Sources documentaires", "Gerez les documents disponibles comme references."],
        analysis: ["Analyse des donnees", "Controlez la completude, la coherence et les anomalies."],
        performance: ["Performances", "Suivez la latence et la consommation mesurees."],
        ratings: ["Evaluation des reponses", "Consultez les notes enregistrees sur les reponses."],
    };

    function setActiveView(viewName) {
        const selectedView = viewLabels[viewName] ? viewName : "dashboard";
        const [title, description] = viewLabels[selectedView];
        viewPanels.forEach((panel) => {
            panel.classList.toggle("hidden", panel.dataset.viewPanel !== selectedView);
        });
        sidebarLinks.forEach((link) => {
            const active = link.dataset.viewTarget === selectedView;
            link.classList.toggle("bg-indigo-50", active);
            link.classList.toggle("text-indigo-700", active);
            link.classList.toggle("font-semibold", active);
            link.classList.toggle("text-slate-600", !active);
            link.classList.toggle("font-medium", !active);
            if (active) link.setAttribute("aria-current", "page");
            else link.removeAttribute("aria-current");
        });
        assistantActions.forEach((element) => {
            element.classList.toggle("hidden", selectedView !== "assistant");
        });
        pageHeading.textContent = title;
        pageDescription.textContent = description;
        window.scrollTo({ top: 0, behavior: "auto" });
        return selectedView;
    }

    function closeMobileSidebar() {
        appSidebar.classList.add("-translate-x-full");
        sidebarOverlay.classList.add("hidden");
        mobileNavToggle.setAttribute("aria-expanded", "false");
        document.body.classList.remove("overflow-hidden");
    }

    mobileNavToggle.addEventListener("click", () => {
        appSidebar.classList.remove("-translate-x-full");
        sidebarOverlay.classList.remove("hidden");
        mobileNavToggle.setAttribute("aria-expanded", "true");
        document.body.classList.add("overflow-hidden");
        closeSidebarButton.focus();
    });
    closeSidebarButton.addEventListener("click", closeMobileSidebar);
    sidebarOverlay.addEventListener("click", closeMobileSidebar);
    document.querySelectorAll("[data-view-target]").forEach((control) => {
        control.addEventListener("click", () => {
            const selectedView = setActiveView(control.dataset.viewTarget);
            if (selectedView === "dashboard") refreshDashboard();
            closeMobileSidebar();
        });
    });
    dashboardRefreshButton.addEventListener("click", async () => {
        dashboardRefreshButton.disabled = true;
        dashboardRefreshButton.setAttribute("aria-busy", "true");
        dashboardRefreshButton.textContent = "Actualisation...";
        await refreshDashboard();
        dashboardRefreshButton.disabled = false;
        dashboardRefreshButton.removeAttribute("aria-busy");
        dashboardRefreshButton.textContent = "Actualiser";
    });
    setActiveView("dashboard");

    function applyTheme(isDark) {
        document.documentElement.classList.toggle("dark", isDark);
        themeToggle.setAttribute("aria-pressed", String(isDark));
        themeToggle.setAttribute(
            "aria-label",
            isDark ? "Activer le thème clair" : "Activer le thème sombre"
        );
        themeToggleIcon.textContent = isDark ? "☼" : "◐";
    }
    let darkTheme = false;
    try {
        const savedTheme = localStorage.getItem("flaskgpt-theme");
        darkTheme = savedTheme ? savedTheme === "dark" :
            window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch (error) {
        darkTheme = window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    applyTheme(darkTheme);
    themeToggle.addEventListener("click", () => {
        darkTheme = !darkTheme;
        applyTheme(darkTheme);
        try {
            localStorage.setItem("flaskgpt-theme", darkTheme ? "dark" : "light");
        } catch (error) {
            console.info("Le navigateur ne permet pas de mémoriser le thème choisi.");
        }
    });

    function updateExportButton() {
        const unavailable = requestInProgress || exportInProgress ||
            !activeConversationId || conversationHistory.length === 0;
        exportPdfButton.disabled = unavailable;
        exportConversationButton.disabled = unavailable;
        exportFormat.disabled = unavailable;
        exportPdfLabel.textContent = exportInProgress ? "Préparation…" : "Résumé PDF";
        exportConversationLabel.textContent = exportInProgress ? "Préparation…" : "Exporter";
    }

    function renderQualityReport(report) {
        dataQualityReport.replaceChildren();
        const heading = document.createElement("div");
        heading.className = "mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between";
        const title = document.createElement("h3");
        title.className = "text-base font-semibold text-slate-900";
        title.textContent = `Rapport de qualité — ${report.source}`;
        const dimensions = document.createElement("p");
        dimensions.className = "text-xs text-slate-500";
        dimensions.textContent = `${report.rows.toLocaleString("fr-FR")} lignes · ${report.columns} colonnes`;
        heading.append(title, dimensions);
        dataQualityReport.appendChild(heading);

        const scoreSection = document.createElement("div");
        scoreSection.className = "mb-4 rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4";
        const scoreTop = document.createElement("div");
        scoreTop.className = "mb-2 flex items-center justify-between gap-3";
        const scoreLabel = document.createElement("span");
        scoreLabel.className = "text-sm font-semibold text-slate-800";
        scoreLabel.textContent = "Indice global de qualité";
        const scoreValue = document.createElement("span");
        scoreValue.className = "text-lg font-bold text-indigo-700";
        scoreValue.textContent = `${report.quality_score}/100`;
        scoreTop.append(scoreLabel, scoreValue);
        const track = document.createElement("div");
        track.className = "h-2 overflow-hidden rounded-full bg-indigo-100";
        const fill = document.createElement("div");
        fill.className = "h-full rounded-full bg-indigo-600 transition-all";
        fill.style.width = `${Math.max(0, Math.min(100, report.quality_score))}%`;
        track.appendChild(fill);
        scoreSection.append(scoreTop, track);
        dataQualityReport.appendChild(scoreSection);

        const metrics = [
            ["Complétude", `${report.completeness}%`, `${report.missing_cells} valeur(s) manquante(s)`],
            ["Unicité", `${report.uniqueness}%`, `${report.duplicate_rows} doublon(s) de ligne`],
            ["Cohérence", `${report.consistency}%`, `${report.inconsistent_values} type(s) incohérent(s)`],
            ["Conformité du schéma", `${report.schema_conformity}%`, `${report.header_issues + report.row_shape_issues} problème(s) de structure`],
            ["Valeurs atypiques", report.outliers.toLocaleString("fr-FR"), "détectées par la règle IQR"],
        ];
        const metricGrid = document.createElement("div");
        metricGrid.className = "mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5";
        metrics.forEach(([label, value, detail]) => {
            const card = document.createElement("div");
            card.className = "rounded-xl border border-slate-200 bg-white p-4";
            const labelNode = document.createElement("p");
            labelNode.className = "text-xs font-medium text-slate-500";
            labelNode.textContent = label;
            const valueNode = document.createElement("p");
            valueNode.className = "mt-1 text-xl font-bold text-slate-900";
            valueNode.textContent = value;
            const detailNode = document.createElement("p");
            detailNode.className = "mt-1 text-xs text-slate-500";
            detailNode.textContent = detail;
            card.append(labelNode, valueNode, detailNode);
            metricGrid.appendChild(card);
        });
        dataQualityReport.appendChild(metricGrid);

        const columnsTitle = document.createElement("h4");
        columnsTitle.className = "mb-2 text-sm font-semibold text-slate-900";
        columnsTitle.textContent = "Profil des colonnes";
        dataQualityReport.appendChild(columnsTitle);
        const tableWrap = document.createElement("div");
        tableWrap.className = "overflow-x-auto rounded-xl border border-slate-200";
        const table = document.createElement("table");
        table.className = "min-w-full divide-y divide-slate-200 text-left text-sm";
        const thead = document.createElement("thead");
        thead.className = "bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500";
        const headerRow = document.createElement("tr");
        ["Colonne", "Type détecté", "Complétude", "Manquants", "Incohérences", "Atypiques"].forEach((text) => {
            const cell = document.createElement("th");
            cell.className = "whitespace-nowrap px-4 py-3";
            cell.scope = "col";
            cell.textContent = text;
            headerRow.appendChild(cell);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);
        const tbody = document.createElement("tbody");
        tbody.className = "divide-y divide-slate-100 bg-white";
        report.columns_report.forEach((column) => {
            const row = document.createElement("tr");
            [column.name, column.type, `${column.completeness}%`, column.missing, column.inconsistent, column.outliers].forEach((value, index) => {
                const cell = document.createElement("td");
                cell.className = index === 0
                    ? "max-w-64 truncate px-4 py-3 font-medium text-slate-800"
                    : "whitespace-nowrap px-4 py-3 text-slate-600";
                cell.textContent = String(value);
                row.appendChild(cell);
            });
            tbody.appendChild(row);
        });
        table.appendChild(tbody);
        tableWrap.appendChild(table);
        dataQualityReport.appendChild(tableWrap);

        const recommendationsTitle = document.createElement("h4");
        recommendationsTitle.className = "mb-2 mt-5 text-sm font-semibold text-slate-900";
        recommendationsTitle.textContent = "Contrôles et pistes d’action";
        const recommendations = document.createElement("ul");
        recommendations.className = "grid gap-2 sm:grid-cols-2";
        report.recommendations.forEach((recommendation) => {
            const item = document.createElement("li");
            item.className = "rounded-xl bg-slate-50 px-3 py-2.5 text-sm leading-5 text-slate-700";
            item.textContent = recommendation;
            recommendations.appendChild(item);
        });
        const methodology = document.createElement("p");
        methodology.className = "mt-3 text-xs leading-5 text-slate-500";
        methodology.textContent = report.methodology;
        dataQualityReport.append(recommendationsTitle, recommendations, methodology);

        if (report.truncated) {
            const notice = document.createElement("p");
            notice.className = "mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800";
            notice.textContent = "Analyse limitée aux 50 000 premières lignes.";
            dataQualityReport.appendChild(notice);
        }
        dataQualityReport.classList.remove("hidden");
    }

    datasetFileInput.addEventListener("change", () => {
        dataTablePicker.classList.add("hidden");
        dataTableSelect.replaceChildren();
        dataQualityReport.classList.add("hidden");
        dataQualityError.classList.add("hidden");
    });

    dataQualityForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const file = datasetFileInput.files[0];
        if (!file) return;
        if (file.size > 20 * 1024 * 1024) {
            dataQualityError.textContent = "Le fichier dépasse la taille maximale autorisée de 20 Mo.";
            dataQualityError.classList.remove("hidden");
            return;
        }
        analyzeDataButton.disabled = true;
        analyzeDataLabel.textContent = "Analyse…";
        dataQualityError.classList.add("hidden");
        try {
            const response = await fetch("/api/data-quality/analyze", {
                method: "POST",
                body: new FormData(dataQualityForm),
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || "L’analyse n’a pas abouti.");
            if (result.requires_table) {
                dataTableSelect.replaceChildren();
                result.tables.forEach((tableName) => {
                    const option = document.createElement("option");
                    option.value = tableName;
                    option.textContent = tableName;
                    dataTableSelect.appendChild(option);
                });
                dataTablePicker.classList.remove("hidden");
                analyzeDataLabel.textContent = "Analyser la table";
                dataQualityError.textContent = "Choisissez la table SQLite à analyser.";
                dataQualityError.classList.remove("hidden");
            } else {
                dataTablePicker.classList.add("hidden");
                renderQualityReport(result);
                await refreshDashboard();
            }
        } catch (error) {
            dataQualityError.textContent = error instanceof TypeError
                ? "Impossible de joindre Flask. Vérifiez que le serveur fonctionne et réessayez."
                : error.message || "Impossible d’analyser ce fichier.";
            dataQualityError.classList.remove("hidden");
        } finally {
            analyzeDataButton.disabled = false;
            analyzeDataLabel.textContent = "Analyser";
        }
    });

    function formatMetricTokens(value) {
        return value === null || value === undefined
            ? "Non communiqué"
            : Number(value).toLocaleString("fr-FR");
    }

    function formatMetricDuration(value) {
        return value === null || value === undefined
            ? "—"
            : `${Number(value).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} ms`;
    }

    function appendMetricCell(row, text, className = "whitespace-nowrap px-3 py-3 text-slate-600") {
        const cell = document.createElement("td");
        cell.className = className;
        cell.textContent = text;
        row.appendChild(cell);
    }

    function renderLatencyChart(entries, chart = latencyChart, empty = latencyChartEmpty, summaryNode = latencyChartSummary) {
        const points = entries
            .filter((entry) => entry.status === "complete" || entry.status === "partial")
            .filter((entry) => Number.isFinite(Number(entry.response_time_ms)))
            .slice(0, 20)
            .reverse();
        chart.replaceChildren();
        if (!points.length) {
            chart.classList.add("hidden");
            empty.classList.remove("hidden");
            summaryNode.textContent = "Aucune mesure";
            return;
        }
        chart.classList.remove("hidden");
        empty.classList.add("hidden");
        const width = 720;
        const height = 150;
        chart.setAttribute("viewBox", `0 0 ${width} ${height}`);
        chart.setAttribute("preserveAspectRatio", "none");
        const pad = { left: 42, right: 12, top: 12, bottom: 32 };
        const values = points.map((entry) => Number(entry.response_time_ms));
        const min = Math.min(...values);
        const max = Math.max(...values);
        const spread = Math.max(max - min, max * 0.12, 1);
        const low = Math.max(0, min - spread * 0.15);
        const high = max + spread * 0.15;
        const x = (index) => pad.left + index * (width - pad.left - pad.right) / Math.max(points.length - 1, 1);
        const y = (value) => pad.top + (high - value) * (height - pad.top - pad.bottom) / (high - low);
        const ns = "http://www.w3.org/2000/svg";
        [0, 0.5, 1].forEach((fraction) => {
            const guide = document.createElementNS(ns, "line");
            const guideY = pad.top + fraction * (height - pad.top - pad.bottom);
            guide.setAttribute("x1", String(pad.left));
            guide.setAttribute("x2", String(width - pad.right));
            guide.setAttribute("y1", String(guideY));
            guide.setAttribute("y2", String(guideY));
            guide.setAttribute("stroke", "#e2e8f0");
            guide.setAttribute("stroke-dasharray", "3 4");
            chart.appendChild(guide);
            const scaleLabel = document.createElementNS(ns, "text");
            scaleLabel.setAttribute("x", "2");
            scaleLabel.setAttribute("y", String(guideY - 3));
            scaleLabel.setAttribute("fill", "#64748b");
            scaleLabel.setAttribute("font-size", "9");
            scaleLabel.textContent = Math.round(high - fraction * (high - low)).toLocaleString("fr-FR");
            chart.appendChild(scaleLabel);
        });
        const polyline = document.createElementNS(ns, "polyline");
        polyline.setAttribute("points", points.map((entry, index) => `${x(index)},${y(Number(entry.response_time_ms))}`).join(" "));
        polyline.setAttribute("fill", "none");
        polyline.setAttribute("stroke", "#4f46e5");
        polyline.setAttribute("stroke-width", "3");
        polyline.setAttribute("stroke-linecap", "round");
        polyline.setAttribute("stroke-linejoin", "round");
        chart.appendChild(polyline);
        points.forEach((entry, index) => {
            const dot = document.createElementNS(ns, "circle");
            dot.setAttribute("cx", String(x(index)));
            dot.setAttribute("cy", String(y(Number(entry.response_time_ms))));
            dot.setAttribute("r", "3.5");
            dot.setAttribute("fill", "#4f46e5");
            dot.setAttribute("aria-label", `${formatMetricDuration(entry.response_time_ms)} | ${entry.title}`);
            chart.appendChild(dot);
        });
        [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])].forEach((index) => {
            const label = document.createElementNS(ns, "text");
            label.setAttribute("x", String(x(index)));
            label.setAttribute("y", String(height - 5));
            label.setAttribute("fill", "#64748b");
            label.setAttribute("font-size", "9");
            label.setAttribute("text-anchor", index === 0 ? "start" : index === points.length - 1 ? "end" : "middle");
            const date = new Date(points[index].created_at);
            label.textContent = Number.isNaN(date.getTime())
                ? String(index + 1)
                : new Intl.DateTimeFormat("fr-FR", {
                    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                }).format(date);
            chart.appendChild(label);
        });
        const average = values.reduce((sum, value) => sum + value, 0) / values.length;
        summaryNode.textContent = `Moyenne : ${formatMetricDuration(average)} | ${points.length} mesure(s)`;
    }

    function renderDomainComparison(domains, container = performanceDomains) {
        container.replaceChildren();
        if (!domains.length) {
            const empty = document.createElement("p");
            empty.className = "rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500";
            empty.textContent = "Aucune requête mesurée par domaine pour le moment.";
            container.appendChild(empty);
            return;
        }
        const maxLatency = Math.max(...domains.map((item) => Number(item.average_response_ms) || 0), 1);
        domains.forEach((item) => {
            const card = document.createElement("div");
            card.className = "rounded-xl border border-slate-200 bg-slate-50/70 p-3";
            const top = document.createElement("div");
            top.className = "flex items-start justify-between gap-3";
            const name = document.createElement("p");
            name.className = "text-sm font-semibold text-slate-800";
            name.textContent = item.domain === "Autre" && item.custom_domain
                ? `Autre · ${item.custom_domain}`
                : item.domain;
            const latency = document.createElement("span");
            latency.className = "whitespace-nowrap text-xs font-semibold text-indigo-700";
            latency.textContent = formatMetricDuration(item.average_response_ms);
            top.append(name, latency);
            const track = document.createElement("div");
            track.className = "mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200";
            const bar = document.createElement("div");
            bar.className = "h-full rounded-full bg-indigo-500";
            bar.style.width = `${Math.max(3, (Number(item.average_response_ms || 0) / maxLatency) * 100)}%`;
            track.appendChild(bar);
            const details = document.createElement("p");
            details.className = "mt-2 text-xs text-slate-500";
            details.textContent = `${item.requests} requête(s) · ${formatMetricTokens(item.total_tokens)} tokens mesurés · ${item.errors || 0} erreur(s)`;
            card.append(top, track, details);
            container.appendChild(card);
        });
    }

    function renderTokenUsageChart(overall) {
        dashboardTokenChart.replaceChildren();
        const measurements = [
            ["Entree", overall.prompt_tokens, overall.prompt_token_reports, "bg-indigo-500"],
            ["Sortie", overall.completion_tokens, overall.completion_token_reports, "bg-violet-500"],
        ].filter(([, value]) => value !== null && value !== undefined);
        const total = measurements.reduce((sum, [, value]) => sum + Number(value), 0);
        dashboardTokenEmpty.classList.toggle("hidden", measurements.length > 0 || overall.token_reports > 0);
        if (!measurements.length) {
            if (overall.token_reports > 0) {
                const note = document.createElement("p");
                note.className = "text-sm text-slate-600";
                note.textContent = `Groq a communiqué ${formatMetricTokens(overall.total_tokens)} au total, sans détail entrée/sortie.`;
                dashboardTokenChart.appendChild(note);
            }
            return;
        }
        measurements.forEach(([label, value, reportCount, color]) => {
                const row = document.createElement("div");
                row.className = "dashboard-token-row";
                const header = document.createElement("div");
                header.className = "flex items-center justify-between gap-3 text-sm";
                const name = document.createElement("span");
                name.className = "font-medium text-slate-700";
                name.textContent = label;
                const amount = document.createElement("span");
                amount.className = "font-semibold text-slate-900";
                amount.textContent = `${Number(value).toLocaleString("fr-FR")} | ${reportCount} mesure(s)`;
                header.append(name, amount);
                const track = document.createElement("div");
                track.className = "mt-2 h-2 overflow-hidden rounded-full bg-slate-100";
                const bar = document.createElement("div");
                bar.className = `h-full rounded-full ${color}`;
                bar.style.width = `${total ? Math.max(2, Number(value) / total * 100) : 0}%`;
                track.appendChild(bar);
                row.append(header, track);
                dashboardTokenChart.appendChild(row);
            });
        const note = document.createElement("p");
        note.className = "mt-4 text-xs text-slate-500";
        note.textContent = "Cumul calculé uniquement à partir des compteurs réellement fournis par Groq.";
        dashboardTokenChart.appendChild(note);
    }

    function buildRecentRatingCard(rating) {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "dashboard-list-item w-full text-left";
        const title = document.createElement("span");
        title.className = "block truncate text-sm font-semibold text-slate-800";
        title.textContent = rating.title;
        const metadata = document.createElement("span");
        metadata.className = "mt-1 block text-xs text-slate-500";
        const date = new Date(rating.updated_at);
        const dateLabel = Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("fr-FR", {
            day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
        }).format(date);
        metadata.textContent = `${rating.rating} | ${dateLabel}`;
        const excerpt = document.createElement("span");
        excerpt.className = "mt-2 block line-clamp-2 text-sm leading-5 text-slate-600";
        excerpt.textContent = rating.excerpt;
        card.append(title, metadata, excerpt);
        card.addEventListener("click", () => openConversation(rating.conversation_id));
        return card;
    }

    function renderRecentRatings(ratings) {
        [dashboardRecentRatings, ratingsRecentList].forEach((container) => {
            container.replaceChildren();
            ratings.forEach((rating) => container.appendChild(buildRecentRatingCard(rating)));
        });
        dashboardRatingsEmpty.classList.toggle("hidden", ratings.length > 0);
        ratingsRecentEmpty.classList.toggle("hidden", ratings.length > 0);
    }

    function renderDashboardQuality(reports) {
        dashboardQualitySummary.replaceChildren();
        const latest = reports[0];
        dashboardQualityEmpty.classList.toggle("hidden", Boolean(latest));
        if (!latest) return;
        const score = document.createElement("div");
        score.className = "dashboard-quality-score";
        score.textContent = `${latest.quality_score}/100`;
        score.setAttribute("aria-label", `Score de qualite ${latest.quality_score} sur 100`);
        const details = document.createElement("div");
        details.className = "min-w-0 flex-1";
        const source = document.createElement("p");
        source.className = "truncate text-sm font-semibold text-slate-800";
        source.textContent = latest.source;
        const summary = document.createElement("p");
        summary.className = "mt-1 text-sm text-slate-600";
        summary.textContent = `${Number(latest.rows).toLocaleString("fr-FR")} lignes | ${latest.columns} colonnes | ${latest.missing_cells} manquantes | ${latest.duplicate_rows} doublons`;
        const date = document.createElement("p");
        date.className = "mt-1 text-xs text-slate-500";
        const created = new Date(latest.created_at);
        date.textContent = Number.isNaN(created.getTime()) ? latest.created_at : new Intl.DateTimeFormat("fr-FR", {
            day: "2-digit", month: "long", year: "numeric",
        }).format(created);
        details.append(source, summary, date);
        dashboardQualitySummary.append(score, details);
    }

    function renderDashboardConversations(conversations) {
        dashboardRecentConversations.replaceChildren();
        dashboardConversationsEmpty.classList.toggle("hidden", conversations.length > 0);
        conversations.slice(0, 5).forEach((conversation) => {
            const item = document.createElement("button");
            item.type = "button";
            item.className = "dashboard-list-item w-full text-left";
            const title = document.createElement("span");
            title.className = "block truncate text-sm font-semibold text-slate-800";
            title.textContent = conversation.title;
            const details = document.createElement("span");
            details.className = "mt-1 block text-xs text-slate-500";
            const date = new Date(conversation.updated_at);
            const domain = conversation.domain === "Autre" && conversation.custom_domain
                ? `Autre | ${conversation.custom_domain}` : conversation.domain;
            const dateLabel = Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("fr-FR", {
                day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
            }).format(date);
            details.textContent = [domain, dateLabel].filter(Boolean).join(" | ");
            item.append(title, details);
            item.addEventListener("click", () => openConversation(conversation.id));
            dashboardRecentConversations.appendChild(item);
        });
    }

    async function refreshDashboard() {
        try {
            const [conversations, performance, ratings, recentRatings, qualityReports] = await Promise.all([
                requestJson("/api/conversations"),
                requestJson("/api/performance"),
                requestJson("/api/ratings/summary"),
                requestJson("/api/ratings/recent"),
                requestJson("/api/data-quality/recent"),
            ]);
            const overall = performance.overall;
            dashboardConversationCount.textContent = conversations.length.toLocaleString("fr-FR");
            dashboardCompleted.textContent = `${overall.completed_requests} / ${overall.requests}`;
            dashboardFailed.textContent = `Echecs : ${overall.errors} | Flux partiels : ${overall.partial_requests}`;
            dashboardLatency.textContent = formatMetricDuration(overall.average_response_ms);
            dashboardTokens.textContent = overall.token_reports
                ? formatMetricTokens(overall.total_tokens) : "Indisponible";
            dashboardTokenDetail.textContent = overall.token_reports
                ? `${overall.token_reports} requete(s) avec compteur total Groq`
                : overall.prompt_token_reports || overall.completion_token_reports
                    ? "Compteurs partiels disponibles; total non communique par Groq"
                    : "Aucun compteur de tokens fourni par Groq";
            const ratingPoints = { satisfaisante: 3, moyenne: 2, insuffisante: 1 };
            const ratingSum = Object.entries(ratings.counts).reduce(
                (sum, [rating, count]) => sum + (ratingPoints[rating] || 0) * count, 0
            );
            dashboardRating.textContent = ratings.total
                ? `${(ratingSum / ratings.total).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} / 3`
                : "Non notee";
            dashboardRatingDetail.textContent = ratings.total
                ? `${ratings.total} reponse(s) evaluee(s)` : "Aucune evaluation enregistree";
            renderLatencyChart(performance.recent_requests, dashboardLatencyChart, dashboardLatencyEmpty, dashboardLatencySummary);
            renderTokenUsageChart(overall);
            renderDomainComparison(performance.domains || [], dashboardDomainComparison);
            renderDashboardConversations(conversations);
            renderRecentRatings(recentRatings);
            renderDashboardQuality(qualityReports);
            dashboardError.classList.add("hidden");
        } catch (error) {
            dashboardError.textContent = error.message || "Impossible de charger les indicateurs du tableau de bord.";
            dashboardError.classList.remove("hidden");
        }
    }

    async function refreshPerformanceDashboard() {
        try {
            const query = activeConversationId
                ? `?conversation_id=${encodeURIComponent(activeConversationId)}`
                : "";
            const response = await fetch(`/api/performance${query}`);
            const report = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(report.error || "Impossible de charger les indicateurs.");
            const overall = report.overall;
            renderLatencyChart(report.recent_requests);
            renderDomainComparison(report.domains || []);

            const cards = [
                ["Requêtes terminées", `${overall.completed_requests} / ${overall.requests}`,
                    `${overall.errors} erreur(s) | ${overall.partial_requests} flux partiel(s)`],
                ["Temps moyen", formatMetricDuration(overall.average_response_ms),
                    `Plus rapide : ${formatMetricDuration(overall.fastest_response_ms)}`],
                ["Totaux de tokens", overall.token_reports
                    ? formatMetricTokens(overall.total_tokens) : "Indisponible",
                    `${overall.token_reports} compteur(s) total fourni(s) par Groq`],
                ["Entrée / sortie", `${overall.prompt_token_reports ? formatMetricTokens(overall.prompt_tokens) : "Indisponible"} / ${overall.completion_token_reports ? formatMetricTokens(overall.completion_tokens) : "Indisponible"}`,
                    `${overall.prompt_token_reports} compteur(s) entrée | ${overall.completion_token_reports} sortie`],
            ];
            performanceCards.replaceChildren();
            cards.forEach(([label, value, detail]) => {
                const card = document.createElement("div");
                card.className = "rounded-xl border border-slate-200 bg-slate-50/70 p-4";
                const labelNode = document.createElement("p");
                labelNode.className = "text-xs font-medium text-slate-500";
                labelNode.textContent = label;
                const valueNode = document.createElement("p");
                valueNode.className = "mt-1 truncate text-xl font-bold text-slate-900";
                valueNode.textContent = value;
                const detailNode = document.createElement("p");
                detailNode.className = "mt-1 text-xs text-slate-500";
                detailNode.textContent = detail;
                card.append(labelNode, valueNode, detailNode);
                performanceCards.appendChild(card);
            });

            performanceConversations.replaceChildren();
            if (!report.conversations.length) {
                const row = document.createElement("tr");
                const cell = document.createElement("td");
                cell.colSpan = 4;
                cell.className = "px-3 py-5 text-center text-sm text-slate-500";
                cell.textContent = "Les indicateurs apparaîtront après la prochaine réponse de l’assistant.";
                row.appendChild(cell);
                performanceConversations.appendChild(row);
            } else {
                report.conversations.forEach((conversation) => {
                    const row = document.createElement("tr");
                    const selected = conversation.conversation_id === activeConversationId;
                    appendMetricCell(row, conversation.title,
                        `max-w-48 truncate px-3 py-3 font-medium ${selected ? "text-indigo-700" : "text-slate-800"}`);
                    appendMetricCell(row, String(conversation.requests));
                    appendMetricCell(row, formatMetricDuration(conversation.average_response_ms));
                    appendMetricCell(row, formatMetricTokens(conversation.total_tokens));
                    performanceConversations.appendChild(row);
                });
            }

            performanceRequests.replaceChildren();
            report.recent_requests.forEach((entry) => {
                const row = document.createElement("tr");
                const firstCell = document.createElement("td");
                firstCell.className = "min-w-28 px-3 py-3";
                const requestType = document.createElement("span");
                requestType.className = "block font-medium text-slate-800";
                requestType.textContent = entry.request_type === "summary" ? "Résumé" : "Réponse";
                const when = document.createElement("span");
                when.className = "mt-0.5 block text-xs text-slate-500";
                const timestamp = new Date(entry.created_at);
                when.textContent = Number.isNaN(timestamp.getTime())
                    ? entry.created_at
                    : new Intl.DateTimeFormat("fr-FR", {
                        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                    }).format(timestamp);
                firstCell.append(requestType, when);
                const status = document.createElement("span");
                status.className = `mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    entry.status === "complete"
                        ? "bg-emerald-50 text-emerald-700"
                        : entry.status === "partial"
                            ? "bg-amber-50 text-amber-700"
                            : "bg-rose-50 text-rose-700"
                }`;
                status.textContent = entry.status === "complete"
                    ? "Terminee"
                    : entry.status === "partial" ? "Flux partiel" : "Echec";
                firstCell.appendChild(status);
                if (entry.error_type) {
                    const errorDetail = document.createElement("span");
                    errorDetail.className = "mt-1 block text-[10px] text-rose-700";
                    errorDetail.textContent = [entry.error_type, entry.error_code].filter(Boolean).join(" | ");
                    firstCell.appendChild(errorDetail);
                }
                if (!activeConversationId) {
                    const title = document.createElement("span");
                    title.className = "mt-0.5 block max-w-36 truncate text-xs text-slate-500";
                    title.textContent = entry.title;
                    firstCell.appendChild(title);
                }
                row.appendChild(firstCell);
                appendMetricCell(row, formatMetricDuration(entry.response_time_ms));
                appendMetricCell(row, formatMetricTokens(entry.prompt_tokens));
                appendMetricCell(row, formatMetricTokens(entry.completion_tokens));
                appendMetricCell(row, formatMetricTokens(entry.total_tokens));
                performanceRequests.appendChild(row);
            });
            if (!report.recent_requests.length) {
                const row = document.createElement("tr");
                const cell = document.createElement("td");
                cell.colSpan = 5;
                cell.className = "px-3 py-5 text-center text-sm text-slate-500";
                cell.textContent = "Aucune requête mesurée pour le moment.";
                row.appendChild(cell);
                performanceRequests.appendChild(row);
            }
            performanceScope.textContent = activeConversationId
                ? "Indicateurs globaux et détails de la conversation sélectionnée."
                : "Latence et consommation mesurées sur les conversations enregistrées.";
            performanceRequestsTitle.textContent = activeConversationId
                ? "Détail de la conversation sélectionnée"
                : "Détail des requêtes récentes";
            performanceError.classList.add("hidden");
        } catch (error) {
            performanceError.textContent = error.message || "Impossible de charger les indicateurs de performance.";
            performanceError.classList.remove("hidden");
        }
    }

    const responseRatingOptions = [
        {
            value: "satisfaisante",
            label: "Satisfaisante",
            button: "border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50",
            selected: ["border-emerald-500", "bg-emerald-100", "text-emerald-900", "ring-1", "ring-emerald-300"],
            card: ["border-l-4", "border-l-emerald-500", "ring-1", "ring-emerald-100"],
        },
        {
            value: "moyenne",
            label: "Moyenne",
            button: "border-amber-200 bg-white text-amber-700 hover:bg-amber-50",
            selected: ["border-amber-500", "bg-amber-100", "text-amber-900", "ring-1", "ring-amber-300"],
            card: ["border-l-4", "border-l-amber-500", "ring-1", "ring-amber-100"],
        },
        {
            value: "insuffisante",
            label: "Insuffisante",
            button: "border-rose-200 bg-white text-rose-700 hover:bg-rose-50",
            selected: ["border-rose-500", "bg-rose-100", "text-rose-900", "ring-1", "ring-rose-300"],
            card: ["border-l-4", "border-l-rose-500", "ring-1", "ring-rose-100"],
        },
    ];

    async function refreshRatingSummary() {
        try {
            const response = await fetch("/api/ratings/summary");
            const summary = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(summary.error || "Chargement impossible.");
            ratingTotal.textContent = `${summary.total} évaluation(s)`;
            Object.entries(ratingCountElements).forEach(([rating, element]) => {
                element.textContent = String(summary.counts[rating] || 0);
            });
        } catch (error) {
            console.error("Impossible de charger le bilan des évaluations.", error);
        }
    }

    function renderResponseRating(messageElement, messageId, currentRating = null) {
        if (!messageId || messageElement.parentElement.querySelector(".response-rating")) return;
        const ratingContainer = document.createElement("div");
        ratingContainer.className = "response-rating mt-4 flex flex-wrap items-center gap-2 border-t border-slate-200/80 pt-3";
        ratingContainer.setAttribute("role", "group");
        ratingContainer.setAttribute("aria-label", "Évaluer cette réponse");

        const prompt = document.createElement("span");
        prompt.className = "mr-1 text-xs font-medium text-slate-500";
        prompt.textContent = "Votre évaluation :";
        ratingContainer.appendChild(prompt);

        const buttons = responseRatingOptions.map((option) => {
            const button = document.createElement("button");
            button.type = "button";
            button.dataset.rating = option.value;
            button.className = [
                "rounded-lg border px-3 py-1.5 text-xs font-semibold transition",
                "focus:outline-none focus:ring-2 focus:ring-offset-1",
                "disabled:cursor-wait disabled:opacity-60",
                option.button,
            ].join(" ");
            button.textContent = option.label;
            button.setAttribute("aria-pressed", String(currentRating === option.value));
            button.addEventListener("click", () => saveResponseRating(
                messageElement, Number(messageId), option.value, buttons
            ));
            ratingContainer.appendChild(button);
            return button;
        });
        messageElement.parentElement.appendChild(ratingContainer);
        updateResponseRatingVisual(messageElement, ratingContainer, currentRating);
    }

    function updateResponseRatingVisual(messageElement, ratingContainer, rating) {
        const card = messageElement.parentElement;
        const allCardClasses = [...new Set(
            responseRatingOptions.flatMap((option) => option.card)
        )];
        card.classList.remove(...allCardClasses);
        ratingContainer.querySelectorAll("button[data-rating]").forEach((button) => {
            const option = responseRatingOptions.find((item) => item.value === button.dataset.rating);
            button.classList.remove(...option.selected);
            button.setAttribute("aria-pressed", String(button.dataset.rating === rating));
            if (button.dataset.rating === rating) {
                button.classList.add(...option.selected);
                card.classList.add(...option.card);
            }
        });
    }

    async function saveResponseRating(messageElement, messageId, rating, buttons) {
        buttons.forEach((button) => { button.disabled = true; });
        try {
            const response = await fetch(`/api/messages/${messageId}/rating`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ rating }),
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || "La note n’a pas pu être enregistrée.");
            const ratingContainer = messageElement.parentElement.querySelector(".response-rating");
            updateResponseRatingVisual(messageElement, ratingContainer, result.rating);
            await refreshRatingSummary();
            await refreshDashboard();
        } catch (error) {
            showChatError(error instanceof TypeError
                ? "Impossible de joindre Flask. Vérifiez que le serveur fonctionne et réessayez."
                : error.message || "La note n’a pas pu être enregistrée.");
        } finally {
            buttons.forEach((button) => { button.disabled = false; });
        }
    }

    function showSourceStatus(message, isError = false) {
        sourcesStatus.textContent = message;
        sourcesStatus.className = isError
            ? "mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800"
            : "mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800";
    }

    async function loadSourceLibrary() {
        try {
            const sources = await requestJson("/api/sources");
            const availableIds = new Set(sources.map((source) => source.id));
            selectedSourceIds.forEach((sourceId) => {
                if (!availableIds.has(sourceId)) selectedSourceIds.delete(sourceId);
            });
            sourceList.replaceChildren();
            emptySources.hidden = sources.length > 0;
            sources.forEach((source) => {
                const item = document.createElement("div");
                item.className = "flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 transition hover:border-indigo-200";
                const checkbox = document.createElement("input");
                checkbox.type = "checkbox";
                checkbox.value = String(source.id);
                checkbox.checked = selectedSourceIds.has(source.id);
                checkbox.disabled = !checkbox.checked && selectedSourceIds.size >= 5;
                checkbox.className = "h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500";
                checkbox.setAttribute("aria-label", `Consulter ${source.name}`);
                checkbox.addEventListener("change", () => {
                    if (checkbox.checked && selectedSourceIds.size >= 5) {
                        checkbox.checked = false;
                        showSourceStatus("Vous pouvez sélectionner jusqu’à cinq sources par question.", true);
                        return;
                    }
                    if (checkbox.checked) selectedSourceIds.add(source.id);
                    else selectedSourceIds.delete(source.id);
                    loadSourceLibrary();
                    sourcesStatus.classList.add("hidden");
                });

                const sourceInfo = document.createElement("div");
                sourceInfo.className = "min-w-0 flex-1";
                const name = document.createElement("span");
                name.className = "block truncate text-sm font-semibold text-slate-800";
                name.textContent = source.name;
                const details = document.createElement("span");
                details.className = "mt-0.5 block text-xs text-slate-500";
                details.textContent = `${source.file_type.toUpperCase()} · ${source.passage_count} extraits indexés`;
                sourceInfo.append(name, details);

                const removeButton = document.createElement("button");
                removeButton.type = "button";
                removeButton.className = "rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 transition hover:bg-rose-50 hover:text-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-500";
                removeButton.textContent = "Supprimer";
                removeButton.setAttribute("aria-label", `Supprimer la source ${source.name}`);
                removeButton.addEventListener("click", async () => {
                    if (!window.confirm(`Supprimer « ${source.name} » de la bibliothèque ?`)) return;
                    removeButton.disabled = true;
                    try {
                        await requestJson(`/api/sources/${source.id}`, { method: "DELETE" });
                        selectedSourceIds.delete(source.id);
                        await loadSourceLibrary();
                        showSourceStatus(`Source « ${source.name} » supprimée.`);
                    } catch (error) {
                        showSourceStatus(error.message || "Impossible de supprimer cette source.", true);
                    }
                });
                item.append(checkbox, sourceInfo, removeButton);
                sourceList.appendChild(item);
            });
        } catch (error) {
            showSourceStatus(error.message || "Impossible de charger les sources.", true);
        }
    }

    sourcesUploadForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const files = [...sourceFilesInput.files];
        if (!files.length) return;
        uploadSourcesButton.disabled = true;
        uploadSourcesButton.textContent = "Importation…";
        let imported = 0;
        try {
            for (const file of files) {
                const formData = new FormData();
                formData.append("source", file);
                await requestJson("/api/sources", { method: "POST", body: formData });
                imported += 1;
            }
            sourceFilesInput.value = "";
            await loadSourceLibrary();
            showSourceStatus(`${imported} document(s) importé(s). Cochez les sources à utiliser pour votre question.`);
        } catch (error) {
            await loadSourceLibrary();
            showSourceStatus(
                imported
                    ? `${imported} document(s) importé(s). ${error.message || "Un autre fichier n’a pas pu être traité."}`
                    : error.message || "Le document n’a pas pu être importé.",
                true,
            );
        } finally {
            uploadSourcesButton.disabled = false;
            uploadSourcesButton.textContent = "Importer";
        }
    });

    function renderSourceReferences(messageElement, references, messageId) {
        const container = document.createElement("section");
        container.className = "source-references mt-4 rounded-xl border border-indigo-100 bg-indigo-50/50 p-3";
        const heading = document.createElement("h4");
        heading.className = "text-xs font-bold uppercase tracking-wide text-indigo-900";
        heading.textContent = "Références et extraits consultés";
        container.appendChild(heading);
        if (!references.length) {
            const empty = document.createElement("p");
            empty.className = "mt-1 text-xs leading-5 text-slate-600";
            empty.textContent = "Aucun extrait documentaire sélectionné ou pertinent pour cette réponse.";
            container.appendChild(empty);
        } else {
            const list = document.createElement("div");
            list.className = "mt-2 flex flex-col gap-2";
            references.forEach((reference) => {
                const details = document.createElement("details");
                details.className = "rounded-lg border border-indigo-100 bg-white px-3 py-2";
                details.id = `source-reference-${messageId}-${reference.code}`;
                const summary = document.createElement("summary");
                summary.className = "cursor-pointer text-xs font-semibold text-indigo-800 focus:outline-none focus:ring-2 focus:ring-indigo-500";
                summary.textContent = `[${reference.code}] ${reference.source_name} · ${reference.location}`;
                const excerpt = document.createElement("p");
                excerpt.className = "mt-2 whitespace-pre-wrap break-words border-l-2 border-indigo-200 pl-3 text-xs leading-5 text-slate-700";
                excerpt.textContent = reference.excerpt;
                details.append(summary, excerpt);
                list.appendChild(details);
            });
            container.appendChild(list);
        }
        messageElement.parentElement.appendChild(container);
        if (references.length) decorateReferenceLinks(messageElement, references, messageId);
    }

    function decorateReferenceLinks(messageElement, references, messageId) {
        const codes = new Set(references.map((reference) => reference.code));
        const walker = document.createTreeWalker(messageElement, NodeFilter.SHOW_TEXT);
        const textNodes = [];
        while (walker.nextNode()) {
            const node = walker.currentNode;
            if (!node.parentElement.closest("code, pre, a")) textNodes.push(node);
        }
        textNodes.forEach((node) => {
            const text = node.textContent;
            const pattern = /\[(R\d+)\]/g;
            let match;
            let offset = 0;
            let hasReference = false;
            const fragment = document.createDocumentFragment();
            while ((match = pattern.exec(text)) !== null) {
                if (!codes.has(match[1])) continue;
                hasReference = true;
                fragment.append(document.createTextNode(text.slice(offset, match.index)));
                const link = document.createElement("a");
                link.href = `#source-reference-${messageId}-${match[1]}`;
                link.className = "font-semibold text-indigo-700 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-900";
                link.textContent = match[0];
                link.addEventListener("click", () => {
                    const target = document.getElementById(link.hash.slice(1));
                    if (target instanceof HTMLDetailsElement) target.open = true;
                });
                fragment.appendChild(link);
                offset = match.index + match[0].length;
            }
            if (hasReference) {
                fragment.append(document.createTextNode(text.slice(offset)));
                node.replaceWith(fragment);
            }
        });
    }

    function renderCopyAction(messageElement) {
        const card = messageElement.parentElement;
        if (card.querySelector(".copy-response-button")) return;
        const toolbar = document.createElement("div");
        toolbar.className = "mt-3 flex justify-end";
        const copyButton = document.createElement("button");
        copyButton.type = "button";
        copyButton.className = "copy-response-button inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500";
        copyButton.textContent = "Copier la r\u00e9ponse";
        copyButton.setAttribute("aria-label", "Copier le texte de cette réponse");
        copyButton.addEventListener("click", async () => {
            try {
                await navigator.clipboard.writeText(messageElement.innerText);
                copyButton.textContent = "Copi\u00e9";
                window.setTimeout(() => { copyButton.textContent = "Copier la r\u00e9ponse"; }, 1600);
            } catch (error) {
                showChatError("Impossible de copier la réponse. Vérifiez les permissions du navigateur.");
            }
        });
        toolbar.appendChild(copyButton);
        card.appendChild(toolbar);
    }

    refreshPerformanceButton.addEventListener("click", refreshPerformanceDashboard);

    async function downloadConversationSummary() {
        if (exportPdfButton.disabled) return;
        clearChatError();
        exportInProgress = true;
        updateExportButton();
        try {
            const response = await fetch(
                `/api/conversations/${encodeURIComponent(activeConversationId)}/summary.pdf`
            );
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.error || "Impossible de générer le résumé PDF.");
            }

            const pdf = await response.blob();
            const disposition = response.headers.get("Content-Disposition") || "";
            const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
            const link = document.createElement("a");
            const objectUrl = URL.createObjectURL(pdf);
            link.href = objectUrl;
            link.download = filenameMatch?.[1] || "resume-flaskgpt.pdf";
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        } catch (error) {
            showChatError(
                error instanceof TypeError
                    ? "Impossible de joindre Flask. Vérifiez que le serveur fonctionne et réessayez."
                    : error.message || "Impossible de générer le résumé PDF. Réessayez."
            );
        } finally {
            exportInProgress = false;
            updateExportButton();
            await refreshPerformanceDashboard();
        }
    }

    async function downloadFullConversation() {
        if (exportConversationButton.disabled) return;
        clearChatError();
        exportInProgress = true;
        updateExportButton();
        try {
            const format = exportFormat.value;
            const response = await fetch(
                `/api/conversations/${encodeURIComponent(activeConversationId)}/export/${format}`
            );
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.error || "Impossible d’exporter la conversation.");
            }

            const file = await response.blob();
            const disposition = response.headers.get("Content-Disposition") || "";
            const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
            const link = document.createElement("a");
            const objectUrl = URL.createObjectURL(file);
            link.href = objectUrl;
            link.download = filenameMatch?.[1] || `conversation-flaskgpt.${format}`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        } catch (error) {
            showChatError(
                error instanceof TypeError
                    ? "Impossible de joindre Flask. Vérifiez que le serveur fonctionne et réessayez."
                    : error.message || "Impossible d’exporter la conversation. Réessayez."
            );
        } finally {
            exportInProgress = false;
            updateExportButton();
        }
    }

    async function requestJson(url, options = {}) {
        const response = await fetch(url, options);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || "La requête n’a pas abouti.");
        }
        return data;
    }

    function renderConversationList(conversations) {
        conversationCount.textContent = String(conversations.length);
        emptyConversations.hidden = conversations.length > 0;
        historyEmpty.classList.toggle("hidden", conversations.length > 0);

        [conversationList, historyConversationList].forEach((container) => {
            container.replaceChildren();
            conversations.forEach((conversation) => {
                const item = document.createElement("button");
                item.type = "button";
                item.setAttribute("role", "listitem");
                item.disabled = requestInProgress;
                item.setAttribute("aria-current", conversation.id === activeConversationId ? "true" : "false");
                item.className = container === historyConversationList
                    ? "dashboard-list-item w-full text-left"
                    : [
                        "w-full rounded-xl px-3 py-2.5 text-left transition",
                        "hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500",
                        "disabled:cursor-wait disabled:opacity-60",
                        conversation.id === activeConversationId ? "bg-indigo-50 text-indigo-900" : "text-slate-700",
                    ].join(" ");

                const title = document.createElement("span");
                title.className = "block truncate text-sm font-medium";
                title.textContent = conversation.title;
                const details = document.createElement("span");
                details.className = "mt-1 block truncate text-xs text-slate-500";
                const updatedAt = new Date(conversation.updated_at);
                const dateLabel = Number.isNaN(updatedAt.getTime())
                    ? ""
                    : new Intl.DateTimeFormat("fr-FR", {
                        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                    }).format(updatedAt);
                const domainLabel = conversation.domain === "Autre" && conversation.custom_domain
                    ? `Autre | ${conversation.custom_domain}`
                    : conversation.domain;
                details.textContent = [domainLabel, dateLabel].filter(Boolean).join(" | ");
                item.append(title, details);
                item.addEventListener("click", () => openConversation(conversation.id));
                container.appendChild(item);
            });
        });
    }

    async function refreshConversationList() {
        try {
            const conversations = await requestJson("/api/conversations");
            renderConversationList(conversations);
        } catch (error) {
            console.error("Impossible de charger l’historique.", error);
        }
    }

    async function openConversation(conversationId) {
        if (requestInProgress) return;

        try {
            const conversation = await requestJson(
                `/api/conversations/${encodeURIComponent(conversationId)}`
            );
            activeConversationId = conversation.id;
            setActiveView("assistant");
            conversationHistory = conversation.messages.map(message => message.content);
            updateExportButton();
            gptOutput.replaceChildren();
            conversation.messages.forEach((message) => {
                const messageElement = appendMessage(message.content, message.role);
                if (message.role === "assistant") {
                    renderSourceReferences(
                        messageElement, message.source_references || [], message.id
                    );
                    renderCopyAction(messageElement);
                    renderResponseRating(messageElement, message.id, message.rating);
                }
            });
            domainSelect.value = conversation.domain;
            customDomainInput.value = conversation.custom_domain || "";
            updateDomainHint();
            clearChatError();
            await refreshConversationList();
            await refreshPerformanceDashboard();
        } catch (error) {
            console.error("Impossible d’ouvrir cette conversation.", error);
            showChatError("Impossible d’ouvrir cette conversation. Réessayez.");
        }
    }

    // Met à jour le texte d’aide selon le domaine sélectionné.
    function updateDomainHint() {
        const selectedOption = domainSelect.selectedOptions[0];
        const isOther = domainSelect.value === "Autre";
        customDomainField.classList.toggle("hidden", !isOther);
        customDomainInput.required = isOther;
        domainHint.textContent = isOther
            ? "Précisez votre domaine ici avant de poser votre question."
            : selectedOption.dataset.description;
        const specifiedDomain = customDomainInput.value.trim();
        document.querySelector("#chat-domain-badge").textContent = isOther && specifiedDomain
            ? `Autre · ${specifiedDomain}`
            : selectedOption.textContent.trim();
    }

    function showChatError(message) {
        chatErrorMessage.textContent = message;
        chatError.classList.remove("hidden");
        retryLastPromptButton.classList.toggle("hidden", !lastFailedRequest);
    }

    function clearChatError() {
        chatErrorMessage.textContent = "";
        chatError.classList.add("hidden");
        retryLastPromptButton.classList.add("hidden");
    }

    function syncPromptComposer() {
        promptInput.style.height = "auto";
        promptInput.style.height = `${Math.min(promptInput.scrollHeight, 180)}px`;
        promptCounter.textContent = `${promptInput.value.length.toLocaleString("fr-FR")} / 4 000`;
        clearPromptButton.classList.toggle("hidden", !promptInput.value.length);
        clearPromptButton.classList.toggle("inline-flex", Boolean(promptInput.value.length));
    }

    function clearPrompt() {
        promptInput.value = "";
        syncPromptComposer();
        promptInput.focus();
    }

    promptInput.addEventListener("input", syncPromptComposer);
    promptInput.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            event.preventDefault();
            clearPrompt();
        } else if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            if (promptInput.value.trim() && !requestInProgress) form.requestSubmit();
        }
    });
    clearPromptButton.addEventListener("click", clearPrompt);
    syncPromptComposer();

    retryLastPromptButton.addEventListener("click", () => {
        if (!lastFailedRequest || requestInProgress) return;
        form.elements.prompt.value = lastFailedRequest.prompt;
        syncPromptComposer();
        domainSelect.value = lastFailedRequest.domain;
        customDomainInput.value = lastFailedRequest.customDomain || "";
        updateDomainHint();
        form.requestSubmit();
    });

    domainSelect.addEventListener("change", updateDomainHint);
    customDomainInput.addEventListener("input", updateDomainHint);
    exportPdfButton.addEventListener("click", downloadConversationSummary);
    exportConversationButton.addEventListener("click", downloadFullConversation);
    updateDomainHint();
    updateExportButton();

    // Demande confirmation avant d'effacer une conversation existante.
    newChatButton.addEventListener("click", async () => {
        if (requestInProgress) return;

        if (!gptOutput.querySelector(".message")) {
            activeConversationId = null;
            conversationHistory = [];
            updateExportButton();
            clearChatError();
            form.reset();
            syncPromptComposer();
            domainSelect.value = "Général";
            updateDomainHint();
            await refreshConversationList();
            await refreshPerformanceDashboard();
            form.elements.prompt.focus();
            return;
        }

        newChatDialog.showModal();
    });

    // Ferme la confirmation sans modifier la conversation.
    cancelNewChatButton.addEventListener("click", () => {
        newChatDialog.close();
    });

    // Permet aussi de fermer la fenêtre en cliquant sur son arrière-plan.
    newChatDialog.addEventListener("click", (event) => {
        if (event.target === newChatDialog) newChatDialog.close();
    });

    // Efface les messages et remet le formulaire à zéro.
    confirmNewChatButton.addEventListener("click", async () => {
        if (requestInProgress) return;

        gptOutput.replaceChildren();
        activeConversationId = null;
        conversationHistory = [];
        updateExportButton();
        clearChatError();
        form.reset();
        syncPromptComposer();
        domainSelect.value = "Général";
        updateDomainHint();
        newChatDialog.close();
        await refreshConversationList();
        await refreshPerformanceDashboard();
        form.elements.prompt.focus();
    });

    // Exécute cette fonction lors de l’envoi du formulaire.
    // async permet d’utiliser await pour attendre les opérations asynchrones.
    form.addEventListener("submit", async (event) => {
        // Empêche l’envoi classique du formulaire et le rechargement de la page.
        event.preventDefault();

        // Lit la question et retire les espaces au début et à la fin.
        const prompt = form.elements.prompt.value.trim();
        const selectedDomain = domainSelect.value;
        const customDomain = customDomainInput.value.trim();

        // Arrête si la question est vide ou si une réponse est déjà en cours.
        if (!prompt || button.disabled) return;
        if (selectedDomain === "Autre" && !customDomain) {
            showChatError("Indiquez votre domaine dans le champ « Quel est votre domaine ? » avant votre question.");
            customDomainInput.setAttribute("aria-invalid", "true");
            customDomainInput.focus();
            return;
        }
        customDomainInput.removeAttribute("aria-invalid");
        lastFailedRequest = { prompt, domain: selectedDomain, customDomain };

        // Affiche la question de l’utilisateur dans la conversation.
        const userMessageElement = appendMessage(prompt);
        conversationHistory.push(prompt);
        clearChatError();

        // Remet les champs du formulaire à leurs valeurs initiales.
        form.reset();
        domainSelect.value = selectedDomain;
        customDomainInput.value = customDomain;
        updateDomainHint();

        // Désactive le bouton pour éviter plusieurs envois simultanés.
        button.disabled = true;
        requestInProgress = true;
        generationStatus.classList.remove("hidden");
        generationStatus.classList.add("flex");
        updateExportButton();
        newChatButton.disabled = true;
        domainSelect.disabled = true;
        customDomainInput.disabled = true;
        conversationList.querySelectorAll("button").forEach((item) => {
            item.disabled = true;
        });

        let streamStarted = false;
        try {
            if (!activeConversationId) {
                const conversation = await requestJson("/api/conversations", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        title: prompt,
                        domain: selectedDomain,
                        custom_domain: customDomain,
                    }),
                });
                activeConversationId = conversation.id;
                updateExportButton();
            }

            // Envoie les messages et l’identifiant de conversation à Flask.
            const reader = await fetchPromptResponse(
                activeConversationId,
                [...selectedSourceIds],
                Number(passagesPerSourceSelect.value),
                customDomain,
            );
            streamStarted = true;

            // Crée un bloc vide destiné à recevoir la réponse de l’IA.
            const output = appendMessage("", "assistant");

            // Lit et affiche progressivement les fragments de la réponse.
            const assistantMessage = await readResponseChunks(reader, output);
            if (assistantMessage) {
                lastFailedRequest = null;
                conversationHistory.push(assistantMessage);
                try {
                    const savedConversation = await requestJson(
                        `/api/conversations/${encodeURIComponent(activeConversationId)}`
                    );
                    const savedResponse = [...savedConversation.messages]
                        .reverse()
                        .find((message) => message.role === "assistant");
                    if (savedResponse) {
                        renderSourceReferences(
                            output, savedResponse.source_references || [], savedResponse.id
                        );
                        renderCopyAction(output);
                        renderResponseRating(output, savedResponse.id, savedResponse.rating);
                        await refreshRatingSummary();
                    }
                } catch (error) {
                    console.error("Impossible de charger les options d’évaluation.", error);
                }
            }
        } catch (error) {
            console.error(error);
            if (streamStarted) {
                activeConversationId = null;
                conversationHistory = [];
                gptOutput.replaceChildren();
                showChatError(
                    "La connexion a été interrompue pendant la réponse. " +
                    "La conversation enregistrée reste disponible dans votre historique."
                );
            } else {
                userMessageElement.parentElement.remove();
                conversationHistory.pop();
                showChatError(
                    error instanceof TypeError
                        ? "Impossible de joindre Flask. Vérifiez que le serveur fonctionne et réessayez."
                        : error.message || "Impossible d'envoyer le message. Réessayez."
                );
            }
        } finally {
            // Réactive le bouton après la réussite ou l’échec du traitement.
            button.disabled = false;
            requestInProgress = false;
            updateExportButton();
            newChatButton.disabled = false;
            domainSelect.disabled = false;
            customDomainInput.disabled = false;
            conversationList.querySelectorAll("button").forEach((item) => {
                item.disabled = false;
            });
            generationStatus.classList.add("hidden");
            generationStatus.classList.remove("flex");
            await refreshConversationList();
            await refreshPerformanceDashboard();
            await refreshDashboard();
        }
    });

    refreshConversationList();
    refreshPerformanceDashboard();
    refreshRatingSummary();
    refreshDashboard();
    loadSourceLibrary();
});
