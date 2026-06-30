// --- Global JS Error Banner Catcher ---
window.addEventListener('error', function(e) {
    const errorBanner = document.getElementById('global-js-error-banner');
    if (errorBanner) {
        errorBanner.style.display = 'block';
        errorBanner.innerHTML = `⚠️ JS Error: ${e.message} (${e.filename}:${e.lineno})`;
    } else {
        const banner = document.createElement('div');
        banner.id = 'global-js-error-banner';
        banner.style.position = 'fixed';
        banner.style.top = '0';
        banner.style.left = '0';
        banner.style.width = '100%';
        banner.style.backgroundColor = '#ef4444';
        banner.style.color = '#ffffff';
        banner.style.padding = '12px 24px';
        banner.style.zIndex = '9999';
        banner.style.fontSize = '13px';
        banner.style.fontWeight = 'bold';
        banner.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
        banner.innerHTML = `⚠️ JS Error: ${e.message} (${e.filename}:${e.lineno})`;
        document.body.appendChild(banner);
    }
});

document.addEventListener("DOMContentLoaded", () => {
    // --- Global State ---
    const state = {
        currentPage: "page-dashboard",
        library: {
            ads: [],
            total: 0,
            page: 1,
            limit: 12,
            query: "",
            brand: "",
            source: "",
            category: "" // Filter by media category (영상, 캠페인, 옥외광고)
        },
        apiKey: localStorage.getItem("gemini_api_key") || "",
        hasServerKey: false,
        currentAdAnalysis: null
    };

    // --- DOM Elements ---
    const menuItems = document.querySelectorAll(".sidebar-menu .menu-item");
    const pageSections = document.querySelectorAll(".page-section");
    const currentPageTitle = document.getElementById("current-page-title");
    const apiStatusBadge = document.getElementById("api-status-badge");
    const inputApiKey = document.getElementById("settings-api-key");
    const btnSaveSettings = document.getElementById("btn-save-settings");
    const btnClearSettings = document.getElementById("btn-clear-settings");
    const btnToggleKeyVisibility = document.getElementById("btn-toggle-key-visibility");

    // Dashboard elements
    const dashboardAnalyzedGrid = document.getElementById("dashboard-analyzed-grid");
    const btnViewAllLibrary = document.getElementById("btn-view-all-library");
    const realtimeKeywordsList = document.getElementById("realtime-keywords-list");
    const careetNewsList = document.getElementById("careet-news-list");

    // Library elements
    const libraryAdsGrid = document.getElementById("library-ads-grid");
    const librarySearchInput = document.getElementById("library-search-input");
    const filterBrandSelect = document.getElementById("filter-brand-select");
    const filterAgencySelect = document.getElementById("filter-agency-select");
    const btnSearchTrigger = document.getElementById("btn-search-trigger");
    const btnPrevPage = document.getElementById("btn-prev-page");
    const btnNextPage = document.getElementById("btn-next-page");
    const pageIndicator = document.getElementById("page-indicator");
    const categoryTabs = document.querySelectorAll(".library-category-tabs .category-tab");

    // Analyzer elements
    const analyzerUrlInput = document.getElementById("analyzer-url-input");
    const btnAnalyzeStart = document.getElementById("btn-analyze-start");
    const analyzerLoading = document.getElementById("analyzer-loading");
    const analyzerResultContainer = document.getElementById("analyzer-result-container");
    const stepScrape = document.getElementById("step-scrape");
    const stepAi = document.getElementById("step-ai");
    const stepChart = document.getElementById("step-chart");

    // Modal elements
    const detailModal = document.getElementById("detail-modal");
    const detailModalBody = document.getElementById("detail-modal-body");
    const btnCloseModal = document.getElementById("btn-close-modal");

    // Trend Modal elements
    const trendModal = document.getElementById("trend-modal");
    const trendModalBody = document.getElementById("trend-modal-body");
    const btnCloseTrendModal = document.getElementById("btn-close-trend-modal");

    // --- Initial Setup ---
    updateApiStatusUI();
    loadDashboardData();
    loadTrendsData();
    checkKeyStatus();

    async function checkKeyStatus() {
        try {
            const res = await fetch("/api/settings/status");
            const data = await res.json();
            state.hasServerKey = data.has_key;
            updateApiStatusUI();
        } catch (e) {
            console.error("Error checking server key status:", e);
        }
        
        // Sync key to server on startup if we have a local one
        if (state.apiKey) {
            try {
                await fetch("/api/settings/save-key", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ gemini_api_key: state.apiKey })
                });
                state.hasServerKey = true;
                updateApiStatusUI();
            } catch (e) {
                console.error("Startup API Key sync error:", e);
            }
        }
        
        checkMorningBriefing();
    }
    
    if (state.apiKey && inputApiKey) {
        inputApiKey.value = state.apiKey;
    }

    // --- Event Listeners ---
    
    // Sidebar Page Navigation (Robust Event Delegation)
    const sidebarMenu = document.querySelector(".sidebar-menu");
    if (sidebarMenu) {
        sidebarMenu.addEventListener("click", (e) => {
            const item = e.target.closest(".menu-item");
            if (!item) return;
            e.preventDefault();
            const target = item.getAttribute("data-target");
            switchPage(target);
        });
    }

    // Switch Page Function
    function switchPage(pageId) {
        state.currentPage = pageId;
        
        // Update menu active class
        menuItems.forEach(item => {
            if (item.getAttribute("data-target") === pageId) {
                item.classList.add("active");
                if (currentPageTitle) {
                    const span = item.querySelector("span");
                    currentPageTitle.textContent = span ? span.textContent : item.textContent.trim();
                }
            } else {
                item.classList.remove("active");
            }
        });

        // Toggle page visibility
        pageSections.forEach(section => {
            if (section.id === pageId) {
                section.classList.add("active");
            } else {
                section.classList.remove("active");
            }
        });

        // Load page specific data
        if (pageId === "page-dashboard") {
            loadDashboardData();
            loadTrendsData();
        } else if (pageId === "page-library") {
            loadLibraryData();
        }
    }

    // Toggle API Key password visibility
    if (btnToggleKeyVisibility && inputApiKey) {
        btnToggleKeyVisibility.addEventListener("click", () => {
            const type = inputApiKey.type === "password" ? "text" : "password";
            inputApiKey.type = type;
            const icon = btnToggleKeyVisibility.querySelector("i");
            if (icon) {
                icon.classList.toggle("fa-eye");
                icon.classList.toggle("fa-eye-slash");
            }
        });
    }

    // Settings actions
    if (btnSaveSettings && inputApiKey) {
        btnSaveSettings.addEventListener("click", async () => {
            const key = inputApiKey.value.trim();
            if (!key) {
                alert("API Key를 입력해 주세요.");
                return;
            }
            state.apiKey = key;
            state.hasServerKey = true;
            localStorage.setItem("gemini_api_key", key);
            updateApiStatusUI();
            
            try {
                await fetch("/api/settings/save-key", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ gemini_api_key: key })
                });
            } catch (e) {
                console.error("Error syncing API key to server:", e);
            }
            
            alert("Gemini API Key가 성공적으로 저장되었습니다!");
            // Check briefing immediately after saving key
            checkMorningBriefing();
            switchPage("page-dashboard");
        });
    }

    if (btnClearSettings && inputApiKey) {
        btnClearSettings.addEventListener("click", async () => {
            state.apiKey = "";
            state.hasServerKey = false;
            localStorage.removeItem("gemini_api_key");
            inputApiKey.value = "";
            updateApiStatusUI();
            
            try {
                await fetch("/api/settings/clear-key", { method: "POST" });
            } catch (e) {
                console.error("Error clearing API key from server:", e);
            }
            
            alert("API Key가 삭제되었습니다.");
        });
    }

    // API badge update
    function updateApiStatusUI() {
        if (!apiStatusBadge) return;
        const dot = apiStatusBadge.querySelector(".status-dot");
        const txt = apiStatusBadge.querySelector(".status-text");
        if (state.apiKey || state.hasServerKey) {
            if (dot) dot.className = "status-dot online";
            if (txt) txt.textContent = "Gemini API Ready";
        } else {
            if (dot) dot.className = "status-dot offline";
            if (txt) txt.textContent = "API Key 미설정";
        }
    }

    // Recommendation click inside Analyzer (Robust parsing)
    document.querySelectorAll(".analyzer-tips li").forEach(li => {
        li.addEventListener("click", () => {
            const text = li.textContent;
            const urlMatch = text.match(/https?:\/\/[^\s]+/);
            if (urlMatch && analyzerUrlInput) {
                analyzerUrlInput.value = urlMatch[0].trim();
            }
        });
    });

    // Dashboard View All button
    if (btnViewAllLibrary) {
        btnViewAllLibrary.addEventListener("click", () => {
            state.library.category = "";
            state.library.source = "";
            
            categoryTabs.forEach(t => t.classList.remove("active"));
            const defaultCategoryTab = document.querySelector('.category-tab[data-category=""]');
            if (defaultCategoryTab) defaultCategoryTab.classList.add("active");
            
            switchPage("page-library");
        });
    }

    // --- Library Navigation and Search ---
    if (btnSearchTrigger) {
        btnSearchTrigger.addEventListener("click", () => {
            if (librarySearchInput) state.library.query = librarySearchInput.value.trim();
            if (filterBrandSelect) state.library.brand = filterBrandSelect.value;
            if (filterAgencySelect) state.library.source = filterAgencySelect.value;
            state.library.page = 1;
            loadLibraryData();
        });
    }

    if (librarySearchInput) {
        librarySearchInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter" && btnSearchTrigger) {
                btnSearchTrigger.click();
            }
        });
    }

    if (filterBrandSelect) {
        filterBrandSelect.addEventListener("change", () => {
            if (btnSearchTrigger) btnSearchTrigger.click();
        });
    }

    if (filterAgencySelect) {
        filterAgencySelect.addEventListener("change", () => {
            if (btnSearchTrigger) btnSearchTrigger.click();
        });
    }

    if (btnPrevPage) {
        btnPrevPage.addEventListener("click", () => {
            if (state.library.page > 1) {
                state.library.page--;
                loadLibraryData();
            }
        });
    }

    if (btnNextPage) {
        btnNextPage.addEventListener("click", () => {
            const maxPage = Math.ceil(state.library.total / state.library.limit);
            if (state.library.page < maxPage) {
                state.library.page++;
                loadLibraryData();
            }
        });
    }

    // Library Category Tabs click handlers
    categoryTabs.forEach(tab => {
        tab.addEventListener("click", () => {
            categoryTabs.forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            state.library.category = tab.getAttribute("data-category") || "";
            state.library.page = 1;
            loadLibraryData();
        });
    });



    // Modal Close
    if (btnCloseModal) {
        btnCloseModal.addEventListener("click", () => {
            if (detailModal) detailModal.style.display = "none";
            document.body.style.overflow = "auto";
        });
    }

    if (detailModal) {
        detailModal.addEventListener("click", (e) => {
            if (e.target === detailModal && btnCloseModal) {
                btnCloseModal.click();
            }
        });
    }

    if (btnCloseTrendModal) {
        btnCloseTrendModal.addEventListener("click", () => {
            if (trendModal) trendModal.style.display = "none";
            document.body.style.overflow = "auto";
        });
    }

    if (trendModal) {
        trendModal.addEventListener("click", (e) => {
            if (e.target === trendModal && btnCloseTrendModal) {
                btnCloseTrendModal.click();
            }
        });
    }

    // --- API Interactions ---

    // Load Dashboard History
    async function loadDashboardData() {
        if (!dashboardAnalyzedGrid) return;
        try {
            const res = await fetch("/api/analyzed-list");
            const data = await res.json();
            
            dashboardAnalyzedGrid.innerHTML = "";
            
            if (!data || data.length === 0) {
                dashboardAnalyzedGrid.innerHTML = `
                    <div class="empty-state">
                        <i class="fa-solid fa-database"></i>
                        <p>아직 분석된 광고가 없습니다. 아래 라이브러리나 실시간 분석기를 이용해 보세요.</p>
                    </div>
                `;
                return;
            }

            data.slice(0, 4).forEach(ad => {
                const card = createAdCard(ad, true);
                dashboardAnalyzedGrid.appendChild(card);
            });
        } catch (err) {
            console.error("Dashboard list error:", err);
        }
    }

    // Fetch Nate Trends & Careet MZ Trends
    async function loadTrendsData() {
        // 1. Fetch Nate Trends
        try {
            const res = await fetch("/api/trends/realtime");
            const data = await res.json();
            
            if (realtimeKeywordsList) {
                realtimeKeywordsList.innerHTML = "";
                if (data.trends && data.trends.length > 0) {
                    data.trends.forEach((kw, index) => {
                        const rank = index + 1;
                        const item = document.createElement("div");
                        item.className = "keyword-item";
                        item.innerHTML = `
                            <span class="rank-badge ${rank <= 3 ? 'top3' : 'normal'}">${rank}</span>
                            <span class="keyword-name">${kw}</span>
                            <span class="keyword-arrow"><i class="fa-solid fa-chevron-right"></i></span>
                        `;
                        
                        item.addEventListener("click", () => {
                            requestTrendAnalysis(kw);
                        });
                        
                        realtimeKeywordsList.appendChild(item);
                    });
                } else {
                    realtimeKeywordsList.innerHTML = `<p class="loading-small">트렌드를 로드할 수 없습니다.</p>`;
                }
            }
        } catch (err) {
            console.error("Nate trends load error:", err);
            if (realtimeKeywordsList) {
                realtimeKeywordsList.innerHTML = `<p class="loading-small">네트워크 오류</p>`;
            }
        }

        // 2. Fetch Careet MZ Trends
        try {
            const res = await fetch("/api/trends/careet");
            const data = await res.json();
            
            if (careetNewsList) {
                careetNewsList.innerHTML = "";
                if (data.articles && data.articles.length > 0) {
                    data.articles.forEach(art => {
                        const item = document.createElement("a");
                        item.className = "careet-item";
                        item.href = art.url;
                        item.target = "_blank";
                        
                        const fallbackImg = "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=300&q=80";
                        const imgUrl = art.image || fallbackImg;

                        item.innerHTML = `
                            <div class="careet-img-wrapper">
                                <img src="${imgUrl}" alt="${art.title}" onerror="this.src='${fallbackImg}'">
                            </div>
                            <div class="careet-info">
                                <div>
                                    <h4 class="careet-title">${art.title}</h4>
                                    <p class="careet-desc">${art.desc}</p>
                                </div>
                                <div class="careet-footer">
                                    <span>Careet MZ Trend</span>
                                    <span>이동 <i class="fa-solid fa-arrow-up-right-from-square"></i></span>
                                </div>
                            </div>
                        `;
                        careetNewsList.appendChild(item);
                    });
                } else {
                    careetNewsList.innerHTML = `<p class="loading-small">트렌드 피드가 비어 있습니다.</p>`;
                }
            }
        } catch (err) {
            console.error("Careet load error:", err);
            if (careetNewsList) {
                careetNewsList.innerHTML = `<p class="loading-small">네트워크 오류</p>`;
            }
        }

        // 3. Fetch Naver DataLab Trends
        const naverDatalabList = document.getElementById("naver-datalab-list");
        try {
            const res = await fetch("/api/trends/naver-datalab");
            const data = await res.json();
            
            if (naverDatalabList) {
                naverDatalabList.innerHTML = "";
                if (data.trends && data.trends.length > 0) {
                    data.trends.forEach((kw, index) => {
                        const rank = index + 1;
                        const item = document.createElement("div");
                        item.className = "keyword-item";
                        item.innerHTML = `
                            <span class="rank-badge ${rank <= 3 ? 'top3' : 'normal'}" style="background: linear-gradient(135deg, #10b981 0%, #06b6d4 100%);">${rank}</span>
                            <span class="keyword-name">${kw}</span>
                            <span class="keyword-arrow" style="color: var(--color-secondary);"><i class="fa-solid fa-chevron-right"></i></span>
                        `;
                        
                        item.addEventListener("click", () => {
                            requestTrendAnalysis(kw);
                        });
                        
                        naverDatalabList.appendChild(item);
                    });
                } else {
                    naverDatalabList.innerHTML = `<p class="loading-small">트렌드를 로드할 수 없습니다.</p>`;
                }
            }
        } catch (err) {
            console.error("Naver DataLab trends load error:", err);
            if (naverDatalabList) {
                naverDatalabList.innerHTML = `<p class="loading-small">네트워크 오류</p>`;
            }
        }
    }

    // Load Library Ads
    async function loadLibraryData() {
        if (!libraryAdsGrid) return;
        try {
            const listRes = await fetch("/api/analyzed-list");
            const analyzedList = await listRes.json();
            const analyzedIds = new Set(analyzedList.map(a => a.id));

            const { query, brand, source, category, page, limit } = state.library;
            let url = `/api/ads?page=${page}&limit=${limit}`;
            if (query) url += `&q=${encodeURIComponent(query)}`;
            if (brand) url += `&brand=${encodeURIComponent(brand)}`;
            if (source) url += `&source=${encodeURIComponent(source)}`;
            if (category) url += `&category=${encodeURIComponent(category)}`;

            const res = await fetch(url);
            const data = await res.json();

            state.library.total = data.total;
            
            libraryAdsGrid.innerHTML = "";
            if (!data.ads || data.ads.length === 0) {
                libraryAdsGrid.innerHTML = `
                    <div class="empty-state">
                        <i class="fa-solid fa-box-open"></i>
                        <p>검색 결과에 맞는 광고가 존재하지 않습니다.</p>
                    </div>
                `;
                return;
            }

            data.ads.forEach(ad => {
                const isAnalyzed = analyzedIds.has(ad.id);
                let displayAd = { ...ad };
                if (isAnalyzed) {
                    const match = analyzedList.find(a => a.id === ad.id);
                    if (match) {
                        displayAd.match_score = match.match_score;
                        displayAd.sentiment_positive = match.sentiment_positive;
                    }
                }
                const card = createAdCard(displayAd, isAnalyzed);
                libraryAdsGrid.appendChild(card);
            });

            if (filterBrandSelect && filterBrandSelect.children.length <= 1 && data.brands) {
                data.brands.forEach(br => {
                    const opt = document.createElement("option");
                    opt.value = br;
                    opt.textContent = br;
                    filterBrandSelect.appendChild(opt);
                });
            }

            if (filterAgencySelect && filterAgencySelect.children.length <= 1 && data.sources) {
                data.sources.forEach(src => {
                    const opt = document.createElement("option");
                    opt.value = src;
                    opt.textContent = src;
                    filterAgencySelect.appendChild(opt);
                });
            }

            const maxPage = Math.ceil(data.total / limit) || 1;
            if (pageIndicator) pageIndicator.textContent = `${page} / ${maxPage}`;
            if (btnPrevPage) btnPrevPage.disabled = page === 1;
            if (btnNextPage) btnNextPage.disabled = page === maxPage;

        } catch (err) {
            console.error("Library load error:", err);
            libraryAdsGrid.innerHTML = `<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><p>서버와 통신하는 도중 오류가 발생했습니다.</p></div>`;
        }
    }

    // Card Builder
    function createAdCard(ad, isAnalyzed) {
        const card = document.createElement("div");
        card.className = "ad-card";
        
        const fallbackThumb = "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=500&q=80";
        const thumbUrl = ad.image || fallbackThumb;

        let sourceName = ad.source || "TVCF";
        // Extract analysis account if available from the title e.g. [luxmag.kr] -> luxmag.kr
        if (["유튜브", "인스타그램", "틱톡"].includes(sourceName)) {
            const match = (ad.title || "").match(/^\[([^\]]+)\]/);
            if (match) {
                sourceName = `${sourceName} (${match[1]})`;
            }
        }
        let sourceClass = "ad-badge";
        
        card.innerHTML = `
            <div class="ad-thumb">
                <img src="${thumbUrl}" alt="${ad.title}" onerror="this.src='${fallbackThumb}'">
                <span class="${sourceClass}">${sourceName}</span>
                ${isAnalyzed ? '<span class="ad-analyzed-tag"><i class="fa-solid fa-sparkles"></i> AI 분석완료</span>' : ''}
            </div>
            <div class="ad-card-body">
                <div>
                    <div class="ad-brand">${ad.brand}</div>
                    <h4 class="ad-title" title="${ad.title}">${ad.title}</h4>
                </div>
                <div class="ad-card-meta">
                    <span>${ad.onair_date || ad.date || '클릭 시 분석 시작'}</span>
                    ${isAnalyzed && ad.match_score ? `<span class="ad-meta-score"><i class="fa-solid fa-bullseye"></i> 타깃매칭 ${ad.match_score}%</span>` : ''}
                </div>
            </div>
        `;

        card.addEventListener("click", () => {
            requestAdAnalysis(ad.id, ad.url);
        });

        return card;
    }

    // --- Analyze Trigger ---
    async function requestAdAnalysis(adId, customUrl = null) {
        if (!state.apiKey && !state.hasServerKey) {
            alert("Gemini API Key가 없습니다. 설정(Settings) 탭에서 API Key를 먼저 저장해 주세요.");
            switchPage("page-settings");
            return;
        }

        if (detailModalBody) {
            detailModalBody.innerHTML = `
                <div class="scanner-container" style="background: none; border: none;">
                    <div class="scanner-beam"></div>
                    <div class="scanner-text">
                        <h3>AI 분석 리포트 생성 중...</h3>
                        <p style="color: var(--text-muted); font-size:14px;">데이터 추출 및 Gemini 분석 모델을 작동하고 있습니다. 약 5~10초 가량 소요됩니다.</p>
                    </div>
                </div>
            `;
        }
        if (detailModal) {
            detailModal.style.display = "flex";
        }
        document.body.style.overflow = "hidden";

        try {
            const res = await fetch("/api/analyze", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Gemini-API-Key": state.apiKey || ""
                },
                body: JSON.stringify({ ad_id: adId, custom_url: customUrl })
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.detail || "분석 오류 발생");
            }

            const analysisData = await res.json();
            if (detailModalBody) {
                renderDetailedReport(analysisData, detailModalBody);
            }
        } catch (err) {
            console.error("Analysis Request Error:", err);
            if (detailModalBody) {
                detailModalBody.innerHTML = `
                    <div style="text-align: center; padding: 40px 20px;">
                        <i class="fa-solid fa-circle-exclamation" style="font-size: 48px; color: var(--color-danger); margin-bottom: 20px;"></i>
                        <h3>분석 실패</h3>
                        <p style="color: var(--text-muted); margin: 12px 0 24px;">${err.message}</p>
                        <button class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">창 닫기</button>
                    </div>
                `;
            }
        }
    }

    function getUrlHash(url) {
        let hash = 0;
        for (let i = 0; i < url.length; i++) {
            const char = url.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash).toString(36);
    }

    // --- Live URL Analyzer ---
    if (btnAnalyzeStart) {
        btnAnalyzeStart.addEventListener("click", async () => {
            if (!analyzerUrlInput) return;
            const urlVal = analyzerUrlInput.value.trim();
            if (!urlVal) {
                alert("분석할 광고/캠페인 링크를 입력해 주세요.");
                return;
            }

            if (!urlVal.startsWith("http://") && !urlVal.startsWith("https://")) {
                alert("올바른 웹페이지 URL(http:// 또는 https://로 시작) 형태여야 합니다.\n(예시: https://www.youtube.com/watch?v=...)");
                return;
            }

            if (!state.apiKey && !state.hasServerKey) {
                alert("Gemini API Key가 설정되지 않았습니다. 설정 페이지로 이동합니다.");
                switchPage("page-settings");
                return;
            }

            if (analyzerResultContainer) analyzerResultContainer.style.display = "none";
            if (analyzerLoading) analyzerLoading.style.display = "block";
            updateLoadingStep("scrape", "loading");
            updateLoadingStep("ai", "pending");
            updateLoadingStep("chart", "pending");

            let adId = "custom_" + getUrlHash(urlVal);
            try {
                const urlObj = new URL(urlVal);
                if (urlObj.hostname.includes("youtube.com") && urlObj.searchParams.get("v")) {
                    adId = "yt_" + urlObj.searchParams.get("v");
                } else if (urlObj.hostname.includes("youtu.be")) {
                    adId = "yt_" + urlObj.pathname.substring(1);
                } else if (urlObj.hostname.includes("tvcf.co.kr")) {
                    const tvcfMatch = urlVal.match(/\/play\/((?:bi|ai)\d+-\d+)/) || urlVal.match(/\/play\/(\w+)/);
                    if (tvcfMatch) adId = tvcfMatch[1];
                }
            } catch (e) {
                // ignore parsing error, fallback to custom hash
            }

            try {
                await sleep(1500);
                updateLoadingStep("scrape", "success");
                updateLoadingStep("ai", "loading");
                
                const res = await fetch("/api/analyze", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "X-Gemini-API-Key": state.apiKey || ""
                    },
                    body: JSON.stringify({ ad_id: adId, custom_url: urlVal })
                });

                if (!res.ok) {
                    const errData = await res.json();
                    throw new Error(errData.detail || "분석 도중 장애가 일어났습니다.");
                }

                const analysisData = await res.json();
                
                updateLoadingStep("ai", "success");
                updateLoadingStep("chart", "loading");
                await sleep(1000);
                updateLoadingStep("chart", "success");
                
                if (analyzerLoading) analyzerLoading.style.display = "none";
                if (analyzerResultContainer) {
                    analyzerResultContainer.style.display = "block";
                    renderDetailedReport(analysisData, analyzerResultContainer);
                    analyzerResultContainer.scrollIntoView({ behavior: "smooth" });
                }

            } catch (err) {
                console.error("Live analysis error:", err);
                if (analyzerLoading) analyzerLoading.style.display = "none";
                alert("실시간 분석 오류: " + err.message);
            }
        });
    }

    function updateLoadingStep(step, status) {
        const el = document.getElementById(`step-${step}`);
        if (!el) return;
        
        if (status === "pending") {
            el.className = "step";
            el.innerHTML = `<i class="fa-regular fa-circle"></i> ${getStepText(step, "pending")}`;
        } else if (status === "loading") {
            el.className = "step active";
            el.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> ${getStepText(step, "loading")}`;
        } else if (status === "success") {
            el.className = "step completed";
            el.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${getStepText(step, "success")}`;
        }
    }

    function getStepText(step, status) {
        const texts = {
            scrape: {
                pending: "광고 상세 데이터 크롤링 대기",
                loading: "광고 상세 데이터 크롤링 중...",
                success: "광고 스크래핑 및 파싱 완료!"
            },
            ai: {
                pending: "AI 기획 의도 분석 대기",
                loading: "AI 기획 의도 및 트렌드 매핑 중...",
                success: "Gemini AI 캠페인 분석 기획서 작성 완료!"
            },
            chart: {
                pending: "소비자 반응 시뮬레이션 대기",
                loading: "소비자 반응 시뮬레이션 및 데이터 시각화 중...",
                success: "성공 지표 시뮬레이션 완료!"
            }
        };
        return texts[step][status];
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // --- Render Detailed Report in Container ---
    function renderDetailedReport(data, container) {
        if (!data || !container) return;
        
        const fallbackThumb = "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=500&q=80";
        const thumbUrl = data.image || fallbackThumb;
        let sourceName = data.source || "TVCF";
        if (["유튜브", "인스타그램", "틱톡"].includes(sourceName)) {
            const match = (data.title || "").match(/^\[([^\]]+)\]/);
            if (match) {
                sourceName = `${sourceName} (${match[1]})`;
            }
        }

        // Extract match score under new schema
        let matchScore = 95;
        if (data.target_perception && data.target_perception.match_score) {
            matchScore = data.target_perception.match_score;
        } else if (data.target && data.target.match_score) {
            matchScore = data.target.match_score;
        }

        // Backward compatibility for reactions list
        const reactions = (data.response && (data.response.real_reactions || data.response.key_reactions)) || ["소비자 반응 로드 실패"];

        // Handle target_perception fields
        const targetPrimary = data.target_perception ? data.target_perception.primary : (data.target ? data.target.primary : "정보 없음");
        const targetBefore = data.target_perception ? data.target_perception.before : "정보 없음";
        const targetAfter = data.target_perception ? data.target_perception.after : "정보 없음";
        const targetShiftPoint = data.target_perception ? data.target_perception.shift_point : (data.target ? data.target.appeal_point : "정보 없음");

        // Safe text replacements to prevent TypeError
        const getSafeHtmlText = (val) => {
            if (val === undefined || val === null) return "정보 없음";
            return String(val).replace(/\n/g, '<br>');
        };

        const bgText = data.intent ? getSafeHtmlText(data.intent.background) : "정보 없음";
        const objText = data.intent ? getSafeHtmlText(data.intent.objective) : "정보 없음";
        const shiftPointText = getSafeHtmlText(targetShiftPoint);
        const viralText = data.response ? getSafeHtmlText(data.response.viral_factor) : "정보 없음";
        const strengthText = data.ae_takeaway ? getSafeHtmlText(data.ae_takeaway.strengths) : "정보 없음";
        const weaknessText = data.ae_takeaway ? getSafeHtmlText(data.ae_takeaway.weaknesses) : "정보 없음";
        const lessonText = data.ae_takeaway ? getSafeHtmlText(data.ae_takeaway.lessons) : "정보 없음";

        // Sentiment positive, neutral, negative
        const posVal = (data.response && data.response.sentiment_positive !== undefined) ? data.response.sentiment_positive : 50;
        const neuVal = (data.response && data.response.sentiment_neutral !== undefined) ? data.response.sentiment_neutral : 30;
        const negVal = (data.response && data.response.sentiment_negative !== undefined) ? data.response.sentiment_negative : 20;

        // Custom help warning if error message indicates 404 models
        let objectiveDisplayHtml = `<p>${objText}</p>`;
        if (data.intent && data.intent.objective && data.intent.objective.includes("404 models/gemini")) {
            objectiveDisplayHtml = `
                <div style="background: rgba(239, 68, 68, 0.05); border: 1px solid rgba(239, 68, 68, 0.2); padding: 16px; border-radius: 12px; margin-top: 10px;">
                    <h5 style="color: var(--color-danger); font-weight: bold; margin-bottom: 8px;"><i class="fa-solid fa-triangle-exclamation"></i> API 키 설정 오류로 분석이 실패했습니다.</h5>
                    <p style="color: var(--text-muted); font-size: 13.5px; line-height: 1.5;">
                        Google AI Gateway에서 모델(Gemini)을 로드하지 못했습니다. 이는 주로 입력하신 <strong>Gemini API Key</strong>가 존재하지 않거나, 만료되었거나, 아직 활성화되지 않았을 때 발생합니다.<br>
                        왼쪽 최하단의 <strong>설정 (Settings)</strong> 메뉴로 가셔서 본인의 올바른 <code>AIzaSy...</code> 키를 다시 입력하고 저장해 주세요.
                    </p>
                </div>
            `;
        }

        container.innerHTML = `
            <div class="report-header">
                <div class="report-img-wrapper">
                    <img src="${thumbUrl}" alt="${data.title || '광고'}" onerror="this.src='${fallbackThumb}'">
                </div>
                <div class="report-title-info">
                    <span class="report-brand"><i class="fa-solid fa-circle-nodes text-gradient"></i> AI 기획 AE 캠페인 리포트</span>
                    <h2 class="report-title">${data.title || '제목 없음'}</h2>
                    <div class="report-meta-tags">
                        <span class="meta-tag"><i class="fa-solid fa-building"></i> 광고주: ${data.client || data.brand || '정보없음'}</span>
                        <span class="meta-tag"><i class="fa-solid fa-tag"></i> 브랜드: ${data.brand || '정보없음'}</span>
                        <span class="meta-tag"><i class="fa-solid fa-briefcase"></i> 대행사: ${data.agency || sourceName}</span>
                        <span class="meta-tag"><i class="fa-solid fa-calendar"></i> 온에어: ${data.onair_date || '정보없음'}</span>
                        <span class="meta-tag"><i class="fa-solid fa-bullseye"></i> 매칭 스코어: ${matchScore}%</span>
                    </div>
                </div>
            </div>

            <div class="report-tabs">
                <button class="tab-btn active" data-tab="tab-intent">기획 의도 & 전략</button>
                <button class="tab-btn" data-tab="tab-target">타깃 & 공감 포인트</button>
                <button class="tab-btn" data-tab="tab-response">반응 & 바이럴</button>
                <button class="tab-btn" data-tab="tab-takeaway">AE 핵심 가이드</button>
            </div>

            <div class="tab-content active" id="tab-intent">
                <div class="info-block">
                    <h4><i class="fa-solid fa-arrow-trend-up"></i> 캠페인 기획 배경 및 시대적 흐름 (Why)</h4>
                    <p>${bgText}</p>
                </div>
                <div class="info-block">
                    <h4><i class="fa-solid fa-bullseye"></i> 기획 목표 및 전략적 비즈니스 해결 방안</h4>
                    ${objectiveDisplayHtml}
                </div>
            </div>

            <div class="tab-content" id="tab-target">
                <div class="target-positioning">
                    <div class="target-circle-metric">
                        <div class="metric-circle">
                            <span class="metric-value">${matchScore}점</span>
                        </div>
                        <span class="metric-label">타깃 공감 지수</span>
                    </div>
                    <div>
                        <div class="info-block" style="margin-bottom: 0;">
                            <h4>핵심 기획 타깃 특성 및 Pain Point</h4>
                            <p>${getSafeHtmlText(targetPrimary)}</p>
                        </div>
                    </div>
                </div>
                
                <!-- Target Perception Shift Side-by-Side -->
                <div class="perception-shift-wrapper" style="margin-top: 20px; display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                    <div class="info-block" style="border-left: 4px solid var(--color-danger); background: rgba(239, 68, 68, 0.03); margin-bottom: 0;">
                        <h4><i class="fa-solid fa-face-frown text-danger"></i> 기존 인식 (Before)</h4>
                        <p>${getSafeHtmlText(targetBefore)}</p>
                    </div>
                    <div class="info-block" style="border-left: 4px solid var(--color-success); background: rgba(16, 185, 129, 0.03); margin-bottom: 0;">
                        <h4><i class="fa-solid fa-face-smile text-success"></i> 목표 인식 (After)</h4>
                        <p>${getSafeHtmlText(targetAfter)}</p>
                    </div>
                </div>
                
                <div class="info-block" style="margin-top: 20px; border-left: 4px solid var(--color-secondary); background: rgba(6, 182, 212, 0.03);">
                    <h4><i class="fa-solid fa-shuffle"></i> 인식 전환 포인트 (Perception Shift Point)</h4>
                    <p>${shiftPointText}</p>
                </div>
            </div>

            <div class="tab-content" id="tab-response">
                <div class="sentiment-chart-row">
                    <div class="chart-wrapper">
                        <canvas id="sentiment-chart-canvas" width="130" height="130"></canvas>
                        <div class="chart-legend-box">
                            <div class="legend-item"><span class="legend-color" style="background-color: var(--color-success);"></span>긍정 (${posVal}%)</div>
                            <div class="legend-item"><span class="legend-color" style="background-color: var(--color-warning);"></span>중립 (${neuVal}%)</div>
                            <div class="legend-item"><span class="legend-color" style="background-color: var(--color-danger);"></span>부정 (${negVal}%)</div>
                        </div>
                    </div>
                    <div class="reactions-list">
                        <h4><i class="fa-solid fa-comments"></i> 소비자 실제 반응 및 커뮤니티 리얼 보이스</h4>
                        ${reactions.map(r => `<div class="reaction-bubble">${getSafeHtmlText(r)}</div>`).join('')}
                    </div>
                </div>
                <div class="info-block" style="margin-top: 20px;">
                    <h4><i class="fa-solid fa-share-nodes"></i> 소셜 바이럴 매커니즘 작동 방식</h4>
                    <p>${viralText}</p>
                </div>
            </div>

            <div class="tab-content" id="tab-takeaway">
                <div class="info-block">
                    <h4><i class="fa-solid fa-thumbs-up"></i> 광고 기획 강점 (신의 한 수)</h4>
                    <p>${strengthText}</p>
                </div>
                <div class="info-block">
                    <h4><i class="fa-solid fa-triangle-exclamation"></i> 광고 보완 및 리스크 극복 과제</h4>
                    <p>${weaknessText}</p>
                </div>
                <div class="info-block">
                    <h4><i class="fa-solid fa-graduation-cap"></i> AE 실무 벤치마킹 레슨</h4>
                    <div class="lessons-list">
                        <div class="lesson-card">
                            <h5>이 캠페인에서 배울 기획 법칙</h5>
                            <p>${lessonText}</p>
                        </div>
                    </div>
                </div>
            </div>

            <div class="external-link-footer">
                <a href="${data.url || '#'}" target="_blank"><i class="fa-solid fa-arrow-up-right-from-square"></i> 캠페인 공식/리뷰 링크로 이동</a>
            </div>
        `;

        const tabBtns = container.querySelectorAll(".tab-btn");
        const tabContents = container.querySelectorAll(".tab-content");

        tabBtns.forEach(btn => {
            btn.addEventListener("click", () => {
                const targetTab = btn.getAttribute("data-tab");

                tabBtns.forEach(b => b.classList.remove("active"));
                tabContents.forEach(c => c.classList.remove("active"));

                btn.classList.add("active");
                const targetEl = container.querySelector(`#${targetTab}`);
                if (targetEl) targetEl.classList.add("active");
            });
        });

        // Initialize Chart.js
        try {
            const canvasEl = container.querySelector("#sentiment-chart-canvas");
            if (canvasEl && typeof Chart !== "undefined") {
                const ctx = canvasEl.getContext("2d");
                new Chart(ctx, {
                    type: 'doughnut',
                    data: {
                        labels: ['긍정', '중립', '부정'],
                        datasets: [{
                            data: [posVal, neuVal, negVal],
                            backgroundColor: ['#10b981', '#f59e0b', '#ef4444'],
                            borderWidth: 0,
                            hoverOffset: 4
                        }]
                    },
                    options: {
                        responsive: false,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: {
                                display: false
                            }
                        },
                        cutout: '70%'
                    }
                });
            }
        } catch (chartErr) {
            console.error("Chart rendering error:", chartErr);
        }
    }

    // --- Daily Morning Briefing Functions ---
    async function checkMorningBriefing() {
        const btnBell = document.getElementById("btn-morning-briefing");
        const badge = document.getElementById("morning-badge");
        if (!btnBell) return;
        
        try {
            const res = await fetch("/api/trends/morning-briefing");
            if (!res.ok) return;
            const data = await res.json();
            
            if (data && data.briefings && data.briefings.length > 0) {
                if (badge) {
                    badge.style.display = "flex";
                    badge.textContent = "NEW";
                }
                
                // Remove old event listeners by cloning
                const newBell = btnBell.cloneNode(true);
                btnBell.parentNode.replaceChild(newBell, btnBell);
                
                newBell.addEventListener("click", () => {
                    const currentBadge = newBell.querySelector("#morning-badge");
                    if (currentBadge) currentBadge.style.display = "none";
                    showMorningBriefingModal(data);
                });
                
                const todayStr = new Date().toISOString().split('T')[0];
                const lastBriefingShown = localStorage.getItem("last_briefing_shown");
                if (lastBriefingShown !== todayStr) {
                    localStorage.setItem("last_briefing_shown", todayStr);
                    showMorningBriefingToast(data);
                }
            }
        } catch (err) {
            console.error("Error loading morning briefing:", err);
        }
    }

    function showMorningBriefingModal(data) {
        const modal = document.getElementById("morning-briefing-modal");
        const body = document.getElementById("morning-briefing-modal-body");
        if (!modal || !body) return;
        
        let briefsHtml = data.briefings.map(b => `
            <div class="briefing-card" data-id="${b.id}" data-url="${b.url}" style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 16px; padding: 20px; margin-bottom: 20px; display: flex; gap: 20px; position: relative; cursor: pointer; transition: all 0.3s ease;">
                <div class="briefing-img-wrapper" style="width: 140px; height: 100px; border-radius: 12px; overflow: hidden; flex-shrink: 0; background: var(--bg-body); border: 1px solid var(--border-color);">
                    <img src="${b.image || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=300&q=80'}" alt="${b.title}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.src='https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=300&q=80'">
                </div>
                <div class="briefing-info" style="flex-grow: 1;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;">
                        <div>
                            <span class="briefing-brand" style="font-size: 12px; color: var(--color-secondary); font-weight: 600;">${b.brand}</span>
                            <h4 class="briefing-title" style="font-size: 16px; font-weight: bold; margin: 4px 0 8px; color: var(--text-color); text-align: left;">${b.title}</h4>
                        </div>
                        <div class="briefing-score-badge" style="background: rgba(16, 185, 129, 0.1); color: var(--color-success); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 20px; padding: 4px 12px; font-size: 13px; font-weight: bold; display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
                            <i class="fa-solid fa-star"></i> AI 크리에이티브 ${b.score}점
                        </div>
                    </div>
                    <p class="briefing-reason" style="font-size: 13.5px; color: var(--text-muted); line-height: 1.5; margin: 0 0 12px; text-align: left;">${b.reason}</p>
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 15px;">
                        <div class="briefing-takeaway-box" style="background: rgba(6, 182, 212, 0.05); border-left: 3px solid var(--color-secondary); padding: 8px 12px; border-radius: 0 8px 8px 0; font-size: 12.5px; color: var(--color-secondary); text-align: left; flex-grow: 1;">
                            <strong>💡 AE Takeaway:</strong> ${b.takeaway}
                        </div>
                        <span style="font-size: 13px; color: var(--color-primary); font-weight: bold; display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
                            분석서 보기 <i class="fa-solid fa-chevron-right"></i>
                        </span>
                    </div>
                </div>
            </div>
        `).join("");
        
        body.innerHTML = `
            <div style="padding: 10px;">
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
                    <span style="background: var(--gradient-primary); color: white; border-radius: 8px; padding: 4px 10px; font-size: 11px; font-weight: bold; letter-spacing: 0.5px;">DAILY BRIEFING</span>
                    <span style="color: var(--text-muted); font-size: 13px; font-weight: 500;">${data.date}</span>
                </div>
                <h2 style="font-size: 24px; font-weight: 800; margin: 0 0 8px; color: var(--text-color); line-height: 1.3; text-align: left;"><i class="fa-solid fa-sparkles text-gradient" style="margin-right: 6px;"></i>오늘 아침의 AI 창의 광고 브리핑</h2>
                <p style="font-size: 15px; color: var(--text-muted); margin: 0 0 24px; border-bottom: 1px solid var(--border-color); padding-bottom: 16px; font-style: italic; text-align: left;">"${data.headline}"</p>
                
                <div class="briefings-container" style="max-height: 480px; overflow-y: auto; padding-right: 8px;">
                    ${briefsHtml}
                </div>
            </div>
        `;
        
        // Add click event listeners to each briefing card
        const cards = body.querySelectorAll(".briefing-card");
        cards.forEach(card => {
            card.addEventListener("click", () => {
                const adId = card.getAttribute("data-id");
                const url = card.getAttribute("data-url");
                if (adId) {
                    modal.style.display = "none"; // Close morning briefing modal
                    requestAdAnalysis(adId, url); // Open detailed report modal
                }
            });
        });
        
        modal.style.display = "flex";
        document.body.style.overflow = "hidden";
    }

    function showMorningBriefingToast(data) {
        const oldToast = document.querySelector(".morning-brief-banner");
        if (oldToast) oldToast.remove();

        const heroBanner = document.querySelector(".hero-banner");
        if (!heroBanner) return;
        
        const briefBanner = document.createElement("div");
        briefBanner.className = "morning-brief-banner";
        briefBanner.style.cssText = `
            background: linear-gradient(135deg, rgba(6, 182, 212, 0.1) 0%, rgba(139, 92, 246, 0.1) 100%);
            border: 1px solid rgba(139, 92, 246, 0.2);
            border-radius: 16px;
            padding: 16px 20px;
            margin-bottom: 24px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 20px;
        `;
        
        briefBanner.innerHTML = `
            <div style="display: flex; align-items: center; gap: 16px; text-align: left;">
                <div style="background: var(--gradient-primary); color: white; border-radius: 12px; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0; box-shadow: 0 4px 10px rgba(139, 92, 246, 0.3);">
                    <i class="fa-solid fa-mug-hot"></i>
                </div>
                <div>
                    <h4 style="margin: 0; font-size: 15px; font-weight: bold; color: var(--text-color); display: flex; align-items: center; gap: 8px;">
                        오늘 아침의 AI 창의 광고 픽이 도착했습니다! <span style="background: var(--color-danger); color: white; font-size: 10px; padding: 2px 6px; border-radius: 10px; font-weight: 800;">NEW</span>
                    </h4>
                    <p style="margin: 4px 0 0; font-size: 13px; color: var(--text-muted);">${data.headline}</p>
                </div>
            </div>
            <button class="btn btn-primary btn-sm" id="btn-view-briefing-toast" style="padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; flex-shrink: 0;">브리핑 읽기</button>
        `;
        
        heroBanner.parentNode.insertBefore(briefBanner, heroBanner.nextSibling);
        
        const btnView = document.getElementById("btn-view-briefing-toast");
        if (btnView) {
            btnView.addEventListener("click", () => {
                showMorningBriefingModal(data);
            });
        }
    }

    // Modal Close event for Morning Briefing
    const btnCloseMorningModal = document.getElementById("btn-close-morning-modal");
    const morningModal = document.getElementById("morning-briefing-modal");
    if (btnCloseMorningModal && morningModal) {
        btnCloseMorningModal.addEventListener("click", () => {
            morningModal.style.display = "none";
            document.body.style.overflow = "auto";
        });
        morningModal.addEventListener("click", (e) => {
            if (e.target === morningModal) {
                btnCloseMorningModal.click();
            }
        });
    }

    // --- Trend Analysis Interactions ---
    async function requestTrendAnalysis(keyword) {
        if (trendModalBody) {
            trendModalBody.innerHTML = `
                <div class="scanner-container" style="background: none; border: none; padding: 40px 20px;">
                    <div class="scanner-beam"></div>
                    <div class="scanner-text">
                        <h3>AI 트렌드 심층 분석 중...</h3>
                        <p style="color: var(--text-muted); font-size:14px; margin-top:8px;">'${keyword}' 키워드의 급상승 배경 및 사회 흐름을 추적하고 있습니다.</p>
                    </div>
                </div>
            `;
        }
        if (trendModal) {
            trendModal.style.display = "flex";
        }
        document.body.style.overflow = "hidden";

        try {
            const res = await fetch(`/api/trends/analyze?keyword=${encodeURIComponent(keyword)}`, {
                headers: {
                    "X-Gemini-API-Key": state.apiKey || ""
                }
            });
            if (!res.ok) {
                throw new Error("트렌드 분석을 가져오는 도중 장애가 일어났습니다.");
            }
            const trendData = await res.json();
            renderTrendReport(trendData, trendModalBody);
        } catch (err) {
            console.error("Trend analysis error:", err);
            if (trendModalBody) {
                trendModalBody.innerHTML = `
                    <div style="padding: 40px 20px; text-align: center;">
                        <i class="fa-solid fa-triangle-exclamation" style="font-size: 40px; color: var(--color-danger); margin-bottom: 15px;"></i>
                        <h3 style="margin-bottom:8px;">분석 중 오류 발생</h3>
                        <p style="color: var(--text-muted); margin-bottom: 20px; font-size:13.5px;">${err.message}</p>
                        <button class="btn btn-secondary" onclick="document.getElementById('trend-modal').style.display='none'; document.body.style.overflow='auto';">닫기</button>
                    </div>
                `;
            }
        }
    }

    function renderTrendReport(data, container) {
        if (!data || !container) return;
        
        const getSafeHtmlText = (val) => {
            if (val === undefined || val === null) return "정보 없음";
            return String(val).replace(/\n/g, '<br>');
        };

        // Render reference links dynamically
        let refHtml = "";
        if (data.references && data.references.length > 0) {
            data.references.forEach(ref => {
                refHtml += `
                    <a href="${ref.url}" target="_blank" class="meta-tag" style="display: inline-flex; align-items: center; gap: 6px; text-decoration: none; padding: 8px 12px; margin: 4px; font-weight: 500; font-size: 12.5px; color: var(--color-secondary); background: rgba(6, 182, 212, 0.05); border: 1px solid rgba(6, 182, 212, 0.15); border-radius: 8px; transition: all 0.2s;">
                        <i class="fa-solid fa-arrow-up-right-from-square"></i> ${ref.title}
                    </a>
                `;
            });
        } else {
            refHtml = "<p style='color: var(--text-muted); font-size: 13.5px;'>추천 출처 정보가 없습니다.</p>";
        }

        container.innerHTML = `
            <div class="report-title-info" style="margin-bottom: 25px; text-align:left;">
                <span class="report-brand" style="margin-bottom: 8px; display:inline-block;"><i class="fa-solid fa-fire text-gradient"></i> 요즘 급상승 트렌드 분석 리포트</span>
                <h2 class="report-title" style="font-size: 28px; font-weight: 800; color: var(--text-main); margin: 0 0 12px 0;"># ${data.keyword}</h2>
                <p style="font-size: 14.5px; color: var(--color-secondary); line-height: 1.6; background: rgba(6, 182, 212, 0.03); border-left: 3px solid var(--color-secondary); padding: 12px 16px; border-radius: 4px 8px 8px 4px; margin:0;">
                    <strong>요약:</strong> ${getSafeHtmlText(data.summary)}
                </p>
             </div>

             <div class="info-block" style="margin-bottom: 25px; border-left: 4px solid var(--color-primary); background: rgba(139, 92, 246, 0.02); text-align:left;">
                 <h4 style="font-size: 15px; font-weight: 700; color: var(--text-main); margin: 0 0 12px 0; display: flex; align-items: center; gap: 8px;">
                     <i class="fa-solid fa-magnifying-glass-chart" style="color: var(--color-primary);"></i> 사람들이 왜 열광하고 있나요? (급상승 사회 흐름 분석)
                 </h4>
                 <div style="font-size: 14px; color: var(--text-muted); line-height: 1.7; word-break: break-all;">
                     ${getSafeHtmlText(data.reason)}
                 </div>
             </div>

             <div class="info-block" style="margin-bottom: 30px; border-left: 4px solid var(--color-success); background: rgba(16, 185, 129, 0.02); text-align:left;">
                 <h4 style="font-size: 15px; font-weight: 700; color: var(--text-main); margin: 0 0 12px 0; display: flex; align-items: center; gap: 8px;">
                     <i class="fa-solid fa-link" style="color: var(--color-success);"></i> 트렌드 실시간 검색 및 출처 자료
                 </h4>
                 <div style="display: flex; flex-wrap: wrap; margin: -4px;">
                     ${refHtml}
                 </div>
             </div>

             <div class="trend-action-footer" style="display: flex; gap: 12px; margin-top: 25px; border-top: 1px solid rgba(255, 255, 255, 0.08); padding-top: 20px;">
                 <button class="btn btn-primary" id="btn-trend-search-ads" style="flex: 1; display: flex; justify-content: center; align-items: center; gap: 8px; height: 46px; font-weight: 600;">
                     <i class="fa-solid fa-magnifying-glass"></i> 이 키워드 관련 광고 찾기
                 </button>
                 <button class="btn btn-secondary" id="btn-trend-modal-close" style="width: 100px; height: 46px;">
                     닫기
                 </button>
             </div>
        `;

        const btnTrendSearch = document.getElementById("btn-trend-search-ads");
        const btnTrendClose = document.getElementById("btn-trend-modal-close");

        if (btnTrendSearch) {
            btnTrendSearch.addEventListener("click", () => {
                const modal = document.getElementById("trend-modal");
                if (modal) modal.style.display = "none";
                document.body.style.overflow = "";

                switchPage("page-library");
                const librarySearchInput = document.getElementById("library-search-input");
                const btnSearchTrigger = document.getElementById("btn-search-trigger");
                if (librarySearchInput) librarySearchInput.value = data.keyword;
                if (btnSearchTrigger) btnSearchTrigger.click();
            });
        }

        if (btnTrendClose) {
            btnTrendClose.addEventListener("click", () => {
                const modal = document.getElementById("trend-modal");
                if (modal) modal.style.display = "none";
                document.body.style.overflow = "";
            });
        }
    }
});
