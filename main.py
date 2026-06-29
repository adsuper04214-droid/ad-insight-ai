import os
import csv
import json
import requests
from bs4 import BeautifulSoup
import re
import threading
import time
import mimetypes
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")
from fastapi import FastAPI, HTTPException, Header, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Dict
from google import genai
from google.genai import types

app = FastAPI(title="Ad Insight AI Dashboard", version="2.0.0")

CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "server_config.json")
MORNING_BRIEFING_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "morning_briefing.json")

def load_config() -> dict:
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_config(config: dict):
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"Error saving config: {e}")

def get_server_api_key() -> str:
    env_key = os.environ.get("GEMINI_API_KEY", "")
    if env_key:
        return env_key
    config = load_config()
    return config.get("gemini_api_key", "")

def generate_content_with_retry(client, model_name, contents, config, fallback_model='gemini-3.1-flash-lite', max_retries=3):
    import time
    current_model = model_name
    for attempt in range(max_retries):
        try:
            print(f"Calling Gemini API using {current_model} (Attempt {attempt+1}/{max_retries})...")
            response = client.models.generate_content(
                model=current_model,
                contents=contents,
                config=config
            )
            if response.text:
                return response
            raise Exception("Empty response text from Gemini API")
        except Exception as e:
            err_str = str(e)
            print(f"Attempt {attempt+1} failed with error: {err_str}")
            
            is_temporary = "503" in err_str or "429" in err_str or "temporarily" in err_str or "demand" in err_str or "UNAVAILABLE" in err_str
            
            if is_temporary:
                if attempt < max_retries - 1:
                    wait_time = (2 ** attempt) + 1
                    print(f"Temporary error encountered. Waiting {wait_time}s before retry...")
                    time.sleep(wait_time)
                else:
                    if current_model != fallback_model:
                        print(f"All retries failed for {model_name}. Trying fallback model {fallback_model}...")
                        current_model = fallback_model
                        for fb_attempt in range(2):
                            try:
                                response = client.models.generate_content(
                                    model=current_model,
                                    contents=contents,
                                    config=config
                                )
                                if response.text:
                                    return response
                            except Exception as fb_e:
                                print(f"Fallback attempt {fb_attempt+1} failed: {fb_e}")
                                if fb_attempt < 1:
                                    time.sleep(2)
                        raise e
            else:
                raise e
    raise Exception("Failed to generate content after retries")



app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.join(BASE_DIR, "ad_data.csv")
AGENCY_PATH = os.path.join(BASE_DIR, "agency_data.json")
CACHE_PATH = os.path.join(BASE_DIR, "analyzed_ads.json")

# In-memory storage
ALL_ADS = []
AGENCY_ADS = []

def classify_media_category(url: str, title: str, media_name: str = "") -> str:
    url_lower = url.lower()
    title_lower = title.lower()
    media_lower = media_name.lower()
    
    # 1. Detect OOH (옥외광고)
    ooh_keywords = ["ooh", "outdoor", "옥외", "팝업", "popup", "지하철", "버스", "bus", "전광판", "빌보드", "billboard", "street", "거리", "광장", "station", "체험", "빌리지", "랩핑", "공간", "스토어", "전시", "포토존", "사이니지", "터널"]
    if any(k in url_lower or k in title_lower or k in media_lower for k in ooh_keywords):
        return "옥외광고"
        
    # 2. Detect Print / Magazine (인쇄/잡지)
    print_keywords = ["잡지", "인쇄", "지면", "포스터", "매거진", "print", "magazine", "poster", "인쇄광고"]
    if any(k in url_lower or k in title_lower or k in media_lower for k in print_keywords):
        return "인쇄/잡지"
        
    # 3. Detect Social Media (소셜미디어)
    social_keywords = ["instagram", "tiktok", "youtube", "sns", "인스타", "유튜브", "틱톡", "블로그", "소셜", "facebook", "페이스북", "shorts", "reels", "릴스", "쇼츠"]
    if any(k in url_lower or k in title_lower or k in media_lower for k in social_keywords):
        return "소셜미디어"
        
    # 4. Detect Digital Campaign (디지털 캠페인)
    campaign_keywords = ["캠페인", "campaign", "챌린지", "challenge", "ar", "vr", "체험형", "프로모션", "이벤트", "인터랙티브", "웹사이트", "앱"]
    if any(k in url_lower or k in title_lower or k in media_lower for k in campaign_keywords):
        return "디지털 캠페인"
        
    # 5. Default to Video (영상)
    return "영상"

def get_youtube_link(brand: str, title: str, fallback_url: str) -> str:
    if "youtube.com" in fallback_url.lower() or "youtu.be" in fallback_url.lower():
        return fallback_url
        
    query = f"{brand} {title} 광고".strip()
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7"
    }
    try:
        import urllib.parse
        encoded_query = urllib.parse.quote(query)
        url = f"https://www.youtube.com/results?search_query={encoded_query}"
        res = requests.get(url, headers=headers, timeout=5)
        if res.status_code == 200:
            html = res.text
            video_ids = re.findall(r'"videoId"\s*:\s*"([^"]+)"', html)
            if video_ids:
                unique_ids = []
                for vid in video_ids:
                    if vid not in unique_ids and len(vid) == 11:
                        unique_ids.append(vid)
                if unique_ids:
                    return f"https://www.youtube.com/watch?v={unique_ids[0]}"
            
            watch_matches = re.findall(r'/watch\?v=([a-zA-Z0-9_-]{11})', html)
            if watch_matches:
                return f"https://www.youtube.com/watch?v={watch_matches[0]}"
    except Exception as e:
        print(f"Error searching YouTube for {query}: {e}")
        
    return fallback_url

def load_all_ads():
    global ALL_ADS, AGENCY_ADS
    ALL_ADS = []
    AGENCY_ADS = []
    
    # 1. Load Curated Ads from JSON (with media_category)
    if os.path.exists(AGENCY_PATH):
        try:
            with open(AGENCY_PATH, "r", encoding="utf-8") as f:
                AGENCY_ADS = json.load(f)
            for ad in AGENCY_ADS:
                ALL_ADS.append(ad)
            print(f"Loaded {len(AGENCY_ADS)} ads from agency_data.json")
        except Exception as e:
            print(f"Error loading agency_data.json: {e}")
            
    # 2. Load TVCF Ads from CSV
    if os.path.exists(CSV_PATH):
        try:
            csv_count = 0
            with open(CSV_PATH, "r", encoding="utf-8-sig") as f:
                reader = csv.reader(f)
                header = next(reader, None)
                for row in reader:
                    if len(row) < 3:
                        continue
                    num = row[0].strip()
                    raw_title = row[1].strip()
                    link = row[2].strip()
                    
                    title = raw_title.replace("\n", " ").replace("\r", " ")
                    title = re.sub(r'\s+', ' ', title).strip()
                    
                    if "/play/" in link:
                        ad_id = link.split("/")[-1]
                        brand = "기타"
                        if title:
                            first_word = title.split()[0]
                            brand = re.sub(r'[\[\]\(\)\{\}]', '', first_word)
                            if len(brand) > 15:
                                brand = brand[:12] + "..."
                                
                        # Detect media format category
                        media_category = classify_media_category(link, title, "TVCF")
                        
                        ALL_ADS.append({
                            "id": ad_id,
                            "title": title,
                            "brand": brand,
                            "url": link,
                            "image": "",
                            "source": "TVCF",
                            "media": "TVCF",
                            "media_category": media_category,
                            "industry": "미분류",
                            "date": "정보 없음",
                            "story": "",
                            "number": num
                        })
                        csv_count += 1
            print(f"Loaded {csv_count} ads from CSV.")
        except Exception as e:
            print(f"Error loading CSV: {e}")

load_all_ads()

def load_cache() -> Dict:
    if os.path.exists(CACHE_PATH):
        try:
            with open(CACHE_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"Error loading cache: {e}")
            return {}
    return {}

def save_cache(cache: Dict):
    try:
        with open(CACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(cache, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"Error saving cache: {e}")

def scrape_tvcf_ad(url: str) -> dict:
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    
    ad_id = url.split("/")[-1] if "/" in url else url
    if not url.startswith("http"):
        url = f"https://tvcf.co.kr/play/{ad_id}"

    try:
        response = requests.get(url, headers=headers, timeout=10)
        if response.status_code != 200:
            raise Exception(f"Failed to fetch TVCF. Status: {response.status_code}")
        
        html = response.text
        soup = BeautifulSoup(html, "html.parser")
        
        pushes = re.findall(r'self\.__next_f\.push\(\[1,\s*"(.*?)"\]\)', html)
        combined_data = ""
        for push in pushes:
            try:
                decoded = json.loads(f'"{push}"')
                combined_data += decoded
            except Exception:
                combined_data += push
                
        start_idx = combined_data.find('{"initialData":')
        if start_idx != -1:
            brace_count = 0
            end_idx = -1
            for i in range(start_idx, len(combined_data)):
                if combined_data[i] == '{':
                    brace_count += 1
                elif combined_data[i] == '}':
                    brace_count -= 1
                    if brace_count == 0:
                        end_idx = i + 1
                        break
            if end_idx != -1:
                json_str = combined_data[start_idx:end_idx]
                parsed = json.loads(json_str)
                init_data = parsed.get("initialData", {})
                
                story_content = init_data.get("story") or init_data.get("ocr") or ""
                if isinstance(story_content, bool):
                    story_content = ""
                
                media_name = init_data.get("mediaCodeName") or ""
                media_category = classify_media_category(url, init_data.get("chapter") or init_data.get("title") or "", media_name)
                
                return {
                    "id": ad_id,
                    "title": init_data.get("chapter") or init_data.get("title") or "제목 없음",
                    "brand": init_data.get("brand") or "정보 없음",
                    "image": init_data.get("image") or "",
                    "media": media_name or "정보 없음",
                    "media_category": media_category,
                    "industry": init_data.get("industry1Name") or init_data.get("industry2Name") or "정보 없음",
                    "date": init_data.get("publishedDate") or init_data.get("registratedDate") or "정보 없음",
                    "story": story_content or "상세 설명 없음 (영상 위주의 광고)",
                    "url": url,
                    "source": "TVCF"
                }
        
        title_tag = soup.find("meta", property="og:title")
        image_tag = soup.find("meta", property="og:image")
        desc_tag = soup.find("meta", property="og:description")
        
        title = title_tag["content"] if title_tag else soup.title.string if soup.title else "제목 없음"
        title = title.replace(" | TVCF", "").strip()
        
        media_category = classify_media_category(url, title)
            
        return {
            "id": ad_id,
            "title": title,
            "brand": title.split()[0] if title.split() else "정보 없음",
            "image": image_tag["content"] if image_tag else "",
            "media": "TV/인터넷",
            "media_category": media_category,
            "industry": "정보 없음",
            "date": "정보 없음",
            "story": desc_tag["content"] if desc_tag else "상세 설명 없음",
            "url": url,
            "source": "TVCF"
        }
    except Exception as e:
        print(f"Scrape error for {url}: {e}")
        return {
            "id": ad_id,
            "title": ad_id,
            "brand": "정보 없음",
            "image": "",
            "media": "TVCF",
            "media_category": classify_media_category(url, ad_id),
            "industry": "정보 없음",
            "date": "정보 없음",
            "story": "상세 설명 없음",
            "url": url,
            "source": "TVCF"
        }

def get_source_from_url(url: str, default_source: str = "외부 링크") -> str:
    url_lower = url.lower()
    
    # Check for specific agency domains or URL keywords first
    agency_keywords = {
        "돌고래유괴단": ["dolgorae", "돌고래유괴단"],
        "디마이너스원": ["d-minusone", "dminusone", "디마이너스원"],
        "제일기획": ["cheil", "제일기획"],
        "이노션": ["innocean", "이노션"],
        "HS애드": ["hsad", "hs애드"],
        "대홍기획": ["daehong", "대홍기획"],
        "TBWA 코리아": ["tbwa"],
        "서비스플랜 코리아": ["serviceplan", "서비스플랜"],
        "차이커뮤니케이션": ["chaicom", "차이커뮤니케이션"],
        "에코마케팅": ["echomarketing", "에코마케팅"],
        "SM C&C": ["smcnc", "sm c&c"],
        "플레이디": ["playd", "플레이디"],
        "나스미디어": ["nasmedia", "나스미디어"],
        "맥캔월드그룹 코리아": ["mccann", "맥캔"],
        "레오버넷 코리아": ["leoburnett", "레오버넷"],
        "디디비 코리아": ["ddb", "디디비"],
        "오길비 코리아": ["ogilvy", "오길비"],
        "애드쿠아 인터랙티브": ["adqua", "애드쿠아"],
        "인크로스": ["incross", "인크로스"],
        "엠포스": ["emforce", "엠포스"]
    }
    
    for agency, keywords in agency_keywords.items():
        if any(k in url_lower for k in keywords):
            return agency
            
    if "youtube.com" in url_lower or "youtu.be" in url_lower:
        return "유튜브"
    elif "instagram.com" in url_lower:
        return "인스타그램"
    elif "tiktok.com" in url_lower:
        return "틱톡"
    elif "whatads" in url_lower or "whatas" in url_lower:
        return "왓애즈"
        
    # Ad and marketing magazines keywords
    marketing_mags = ["openads", "iboss", "mobiinside", "ditoday", "mzgeneration", "careet", "MZ세대", "marketing", "마케팅"]
    ad_mags = ["madtimes", "apnews", "adic", "ad.co.kr", "광고정보센터", "디조", "kobaco", "adweek", "adage", "campaignasia"]
    
    if any(k in url_lower for k in marketing_mags):
        return "마케팅 매거진"
    if any(k in url_lower for k in ad_mags):
        return "광고 매거진"
        
    return default_source

def scrape_generic_ad(url: str) -> dict:
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    # Clean ID
    ad_id = re.sub(r'[^a-zA-Z0-9]', '', url.split("/")[-1])
    if not ad_id:
        ad_id = "custom_ad_" + str(int(time.time()))
        
    try:
        response = requests.get(url, headers=headers, timeout=10)
        if response.status_code != 200:
            raise Exception(f"Failed to fetch page. Status: {response.status_code}")
        
        soup = BeautifulSoup(response.text, "html.parser")
        
        # Meta tags
        title_tag = soup.find("meta", property="og:title") or soup.find("meta", name="twitter:title")
        title = title_tag["content"] if title_tag else soup.title.string if soup.title else ""
        if not title:
            h1 = soup.find("h1")
            title = h1.get_text().strip() if h1 else url
            
        title = re.sub(r'\s+', ' ', title).strip()
        
        image_tag = soup.find("meta", property="og:image") or soup.find("meta", name="twitter:image")
        image = image_tag["content"] if image_tag else ""
        
        desc_tag = soup.find("meta", property="og:description") or soup.find("meta", name="description")
        desc = desc_tag["content"] if desc_tag else ""
        
        site_name_tag = soup.find("meta", property="og:site_name")
        raw_source = site_name_tag["content"] if site_name_tag else "외부 사이트"
        source = get_source_from_url(url, raw_source)
        
        brand = "정보 없음"
        if site_name_tag:
            brand = site_name_tag["content"]
        elif title:
            brand_words = title.split()
            if brand_words:
                brand = re.sub(r'[\[\]\(\)\{\}]', '', brand_words[0])
                if len(brand) > 15:
                    brand = brand[:12] + "..."
                    
        date_str = "2026-06-23"
        
        paragraphs = []
        if desc:
            paragraphs.append(desc)
        for p in soup.find_all("p")[:5]:
            p_text = p.get_text().strip()
            if p_text and len(p_text) > 20 and p_text not in paragraphs:
                paragraphs.append(p_text)
        story = "\n".join(paragraphs)[:1000]
        if not story:
            story = "상세 설명 없음 (웹페이지 본문을 추출할 수 없습니다)"
            
        media_category = classify_media_category(url, title, source)
            
        return {
            "id": ad_id,
            "title": title or "제목 미분류 광고",
            "brand": brand,
            "image": image,
            "media": "디지털/모바일" if "youtube" in url.lower() or "instagram" in url.lower() else "웹 사이트",
            "media_category": media_category,
            "industry": "미분류",
            "date": date_str,
            "story": story,
            "url": url,
            "source": source
        }
    except Exception as e:
        print(f"Generic scrape error for {url}: {e}")
        return {
            "id": ad_id,
            "title": url,
            "brand": "정보 없음",
            "image": "",
            "media": "웹 사이트",
            "media_category": classify_media_category(url, url),
            "industry": "정보 없음",
            "date": "2026-06-23",
            "story": f"웹페이지 내용을 불러오는 데 실패했습니다: {e}",
            "url": url,
            "source": get_source_from_url(url, "외부 링크")
        }

def scrape_ad(url: str) -> dict:
    if "tvcf.co.kr" in url.lower() or ("/play/" in url.lower() and not url.startswith("http")):
        return scrape_tvcf_ad(url)
    else:
        return scrape_generic_ad(url)

# Automated Background Crawler and Morning Briefing
BACKGROUND_WORKERS_STARTED = False

def start_background_workers():
    global BACKGROUND_WORKERS_STARTED
    if BACKGROUND_WORKERS_STARTED:
        return
    BACKGROUND_WORKERS_STARTED = True
    t = threading.Thread(target=background_worker_loop, daemon=True)
    t.start()

def crawl_latest_tvcf_ads() -> List[str]:
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    links = []
    try:
        res = requests.get("https://tvcf.co.kr/hot/best", headers=headers, timeout=10)
        if res.status_code == 200:
            found = re.findall(r'(?:/[a-z]{2})?/play/((?:bi|ai)\d+-\d+)', res.text)
            for ad_id in found:
                full_link = f"https://tvcf.co.kr/play/{ad_id}"
                if full_link not in links:
                    links.append(full_link)
    except Exception as e:
        print(f"Error crawling TVCF links: {e}")
    return links

def update_ad_database(links: List[str]):
    global ALL_ADS
    existing_ids = set(ad["id"] for ad in ALL_ADS)
    
    new_ads_count = 0
    new_rows = []
    
    for link in links:
        ad_id = link.split("/")[-1]
        if ad_id in existing_ids:
            continue
            
        print(f"Background worker scraping new ad: {link}")
        ad_info = scrape_tvcf_ad(link)
        if ad_info and ad_info.get("title") != ad_id:
            # Insert after curated ads
            ALL_ADS.insert(len(AGENCY_ADS), ad_info)
            existing_ids.add(ad_id)
            
            new_rows.append([len(ALL_ADS), ad_info["title"], link])
            new_ads_count += 1
            
            if new_ads_count >= 5:
                break
                
    if new_rows and os.path.exists(CSV_PATH):
        try:
            with open(CSV_PATH, "a", newline="", encoding="utf-8-sig") as f:
                writer = csv.writer(f)
                for row in new_rows:
                    writer.writerow(row)
            print(f"Appended {new_ads_count} new ads to ad_data.csv")
        except Exception as e:
            print(f"Error writing to CSV: {e}")

def generate_fallback_briefing(current_date: str):
    fallback_data = {
      "date": current_date,
      "headline": "2026년도 상반기, 온디바이스 AI와 소비자 리얼 공감 트렌드가 시장을 지배하다",
      "briefings": [
        {
          "id": "popup-samsung-s26성수",
          "title": "삼성전자 갤럭시 S26 - 성수 AI 커넥션 OOH & 거대 체험 공간",
          "brand": "삼성전자",
          "image": "https://images.unsplash.com/photo-1580927751497-40dec4bf7b40?w=500&q=80",
          "url": "https://www.samsung.com",
          "score": 97,
          "reason": "단순 제품 전시를 넘어 성수동 골목 전체를 하나의 커넥티드 가상 AI 빌리지로 확장한 공간 기획력이 돋보입니다. 차세대 온디바이스 AI 기능인 실시간 공간 매핑을 소비자가 자연스럽게 일상 카페 투어와 포토스팟 참여를 통해 인식하게 만드는 영리한 흐름을 구축했습니다.",
          "takeaway": "기술 중심의 마케팅일수록 소비자가 실제로 노는 공간에 유연하게 동기화시켜야 공감을 극대화할 수 있습니다."
        },
        {
          "id": "creative-nike-ai-coach",
          "title": "나이키(Nike) - '내 손안의 동반자' AI 실시간 러닝 코칭 캠페인",
          "brand": "나이키",
          "image": "https://images.unsplash.com/photo-1476480862126-209bfaa8edc8?w=500&q=80",
          "url": "https://www.nike.com",
          "score": 94,
          "reason": "도심 속 물리적인 전광판(OOH)과 개인 디바이스의 데이터 연동을 극대화하여 초개인화 격려 카피를 노출했습니다. 나와 같은 시각에 한강 바람을 맞으며 달리는 러너들의 유대감을 AI 실시간 데이터 취합을 통해 극대화한 크리에이티브입니다.",
          "takeaway": "디지털 OOH의 미래는 정적인 비주얼 노출을 넘어 스마트 기기 데이터와의 실시간 동기화 인터랙션에 있습니다."
        },
        {
          "id": "creative-starbucks-ar-cup",
          "title": "스타벅스 - '그린 메모리' AR 컵 리사이클 챌질지",
          "brand": "스타벅스",
          "image": "https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=500&q=80",
          "url": "https://www.starbucks.co.kr",
          "score": 91,
          "reason": "친환경 실천이라는 다소 무겁거나 의무적인 메시지를 인스타그램 AR 필터와 모바일 가꾸기 게임 요소(Gamification)를 가미해 세련되게 풀어냈습니다. 컵을 버리는 행위 직전에 가치 있는 디지털 소유물(AR 식물)을 지급해 태도 변화를 유도합니다.",
          "takeaway": "ESG 마케팅을 성공시키려면 소비자에게 의무감을 쥐여주기보다 소셜 미디어에 공유하고 싶은 감성적 장치를 마련해야 합니다."
        }
      ]
    }
    try:
        with open(MORNING_BRIEFING_PATH, "w", encoding="utf-8") as f:
            json.dump(fallback_data, f, indent=2, ensure_ascii=False)
        print("Successfully generated fallback morning briefing.")
    except Exception as e:
        print(f"Error saving fallback briefing: {e}")

def generate_daily_morning_briefing():
    api_key = get_server_api_key()
    current_date = time.strftime("%Y-%m-%d")
    
    if not api_key:
        print("Background worker: No API Key configured. Generating fallback briefing.")
        generate_fallback_briefing(current_date)
        return
        
    if os.path.exists(MORNING_BRIEFING_PATH):
        try:
            with open(MORNING_BRIEFING_PATH, "r", encoding="utf-8") as f:
                existing = json.load(f)
                if existing.get("date") == current_date:
                    return
        except Exception:
            pass
            
    print(f"Background worker: Generating daily morning briefing for {current_date} using Gemini...")
    
    recent_ads = [ad for ad in ALL_ADS if ad.get("source") == "TVCF"][:12]
    if not recent_ads:
        recent_ads = ALL_ADS[:12]
        
    if not recent_ads:
        generate_fallback_briefing(current_date)
        return
        
    ads_summary = []
    for index, ad in enumerate(recent_ads):
        ads_summary.append(f"[{index+1}] ID: {ad['id']}, 제목: {ad['title']}, 브랜드: {ad['brand']}, 설명: {ad.get('story','')}")
        
    prompt = f"""
    당신은 광고 대행사의 수석 크리에이티브 디렉터(CD)입니다.
    제시된 최근 집행된 광고 목록 중에서, 기획 의도가 참신하고 아이디어가 가장 창의적인 광고 3개를 엄선해 주세요.
    각 광고에 대해 왜 선정되었는지 크리에이티브 포인트와 AE 관점의 코멘트(2-3문장), 그리고 크리에이티브 점수(85~99점)를 매겨 주세요.
    
    [광고 목록]
    {chr(10).join(ads_summary)}
    
    출력 형식은 반드시 아래 JSON 스키마를 정확히 따르는 유효한 JSON 객체여야 합니다. JSON 외의 다른 설명 텍스트나 ```json 코드블럭 마크다운 태그를 포함하지 마십시오. 오직 순수한 JSON 문자열만 리턴해 주세요.
    한국어(Korean)로 작성해 주세요.
    
    [JSON Schema]
    {{
      "date": "{current_date}",
      "headline": "오늘 아침의 크리에이티브 트렌드 헤드라인 (한 문장으로 요약)",
      "briefings": [
        {{
          "id": "선정된 광고의 ID",
          "title": "광고 제목",
          "brand": "브랜드명",
          "image": "이미지 URL",
          "url": "원래 URL",
          "score": 크리에이티브 점수,
          "reason": "아이디어 분석 코멘트",
          "takeaway": "한줄 교훈"
        }}
      ]
    }}
    """
    
    try:
        client = genai.Client(api_key=api_key, http_options=types.HttpOptions(api_version='v1beta'))
        config = types.GenerateContentConfig(response_mime_type='application/json')
        response = generate_content_with_retry(client, 'gemini-3.5-flash', prompt, config)
        
        result = json.loads(response.text.strip())
        
        for brief in result.get("briefings", []):
            matched = [ad for ad in recent_ads if ad["id"] == brief.get("id")]
            if matched:
                brief["image"] = matched[0].get("image") or ""
                brief["url"] = matched[0].get("url") or ""
            else:
                ad_id = brief.get("id")
                if ad_id:
                    all_matched = [ad for ad in ALL_ADS if ad["id"] == ad_id]
                    if all_matched:
                        brief["image"] = all_matched[0].get("image") or ""
                        brief["url"] = all_matched[0].get("url") or ""
                    else:
                        if "/" not in ad_id:
                            brief["url"] = f"https://tvcf.co.kr/play/{ad_id}"
                        else:
                            brief["url"] = ad_id
                if not brief.get("image"):
                    brief["image"] = "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=500&q=80"
                
        with open(MORNING_BRIEFING_PATH, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
        print("Background worker: Successfully generated morning_briefing.json")
    except Exception as e:
        print(f"Error generating morning briefing: {e}")
        generate_fallback_briefing(current_date)

def background_worker_loop():
    print("Background worker loop started.")
    try:
        new_links = crawl_latest_tvcf_ads()
        if new_links:
            update_ad_database(new_links)
        generate_daily_morning_briefing()
    except Exception as e:
        print(f"Error in initial background worker cycle: {e}")
        
    while True:
        try:
            time.sleep(10800)
            new_links = crawl_latest_tvcf_ads()
            if new_links:
                update_ad_database(new_links)
            generate_daily_morning_briefing()
        except Exception as e:
            print(f"Error in background worker loop: {e}")

# Deep AE Campaign Analysis Prompt
PROMPT_TEMPLATE = """
당신은 대한민국 최고 광고 대행사(제일기획/이노션/HSAd)의 마스터 광고 기획자(AE)이자 트렌드 분석가입니다.
제시된 광고 캠페인 정보를 기반으로, 전문적이고 깊이 있는 AE 레벨의 캠페인 기획 리포트를 작성해 주세요. 
단순 요약이 아니라 시장분석, 타깃 심리, 크리에이티브 전략이 완벽히 구조화되어야 합니다.

[광고 캠페인 정보]
- 캠페인 제목: {title}
- 브랜드/광고주: {brand}
- 대행사/출처: {source}
- 매체 형태: {media}
- 산업군: {industry}
- 집행 날짜: {date}
- 광고 내용/상세 설명: {story}

[요구사항]
1. 분석은 마케터와 AE 지망생들이 벤치마킹할 수 있도록 철저히 기획 실무 관점에서 전문적인 용어와 논리를 사용해 서술하십시오.
2. 타깃의 기존 인식(Before)과 목표 인식(After)을 한 문장으로 대비되게 날카롭게 뽑아내고, 그 간극을 어떻게 좁혔는지에 대한 '인식 전환 포인트(Perception Shift Point)'를 명확한 크리에이티브 장치와 연결해 논리적으로 분석해 주세요.
3. 소비자 반응(real_reactions)은 최근의 SNS, 커뮤니티, 블로그, 인스타그램 댓글 분위기를 반영하여 극도로 현실적인 한국어 소비자 보이스 4개 이상으로 시뮬레이션해 작성해 주세요.
4. 출력 형식은 반드시 아래 JSON 스키마를 정확히 따르는 유효한 JSON 객체여야 합니다. JSON 외의 다른 설명 텍스트나 ```json 코드블럭 마크다운 태그를 포함하지 마십시오. 오직 순수한 JSON 문자열만 리턴해 주세요.
5. 한국어(Korean)로 작성해 주세요.

[JSON Schema]
{{
  "title": "광고 제목",
  "client": "광고주/클라이언트 회사명 (예: 매일유업, 삼성전자, 영원아웃도어)",
  "brand": "구체적인 캠페인 브랜드명 (예: 소화가 잘되는 우유, 갤럭시 S26, 노스페이스 맥머도)",
  "agency": "제작/대행 대행사 이름 (예: 제일기획, 이노션, HS애드, 이노레드 등 실제 대행사 이름)",
  "onair_date": "집행/온에어 일자 (예: YYYY-MM-DD)",
  "intent": {{
    "background": "캠페인 기획 배경 및 시대적 트렌드 (왜 이 시점에 이 광고/체험형 팝업이 나와야만 했는지 시장 상황, 경쟁사 동향, 사회적 흐름 등을 포함하여 매우 상세하게 분석)",
    "objective": "기획 목표 (이 캠페인을 기획하게 된 구체적인 비즈니스 문제와 크리에이티브 해결 방식)"
  }},
  "target_perception": {{
    "primary": "핵심 타깃의 특성과 결핍 (인구통계학적 특성을 넘어 그들이 가진 심리적 니즈 및 Pain Point를 예리하게 정의)",
    "before": "타깃의 기존 인식 (Before) - 광고를 접하기 전 소비자들이 갖고 있던 브랜드/제품에 대한 태도나 선입견",
    "after": "타깃의 목표 인식 (After) - 캠페인을 본 후 소비자들이 가지길 원했던 이상적인 태도/브랜드 이미지",
    "shift_point": "인식 전환 포인트 (Perception Shift Point) - 기존 인식을 목표 인식으로 전환시킨 결정적인 크리에이티브 요인 및 핵심 메시지/매체 기획 전략 분석"
  }},
  "response": {{
    "sentiment_positive": 긍정 반응 비율 (정수형, 예: 75),
    "sentiment_neutral": 중립 반응 비율 (정수형, 예: 15),
    "sentiment_negative": 부정 반응 비율 (정수형, 예: 10),
    "real_reactions": [
      "리얼 소비자 보이스 1 (구체적이고 리얼한 대어체 소감)",
      "리얼 소비자 보이스 2",
      "리얼 소비자 보이스 3",
      "리얼 소비자 보이스 4"
    ],
    "viral_factor": "소셜 바이럴 매커니즘 (인스타그램 인증 유인, 팝업 체험 코스 설계, 유행 밈 결합 방식 등 소셜 확산을 이끌어낸 실질적 요인 상세 분석)"
  }},
  "ae_takeaway": {{
    "strengths": "기획적 강점 (AE 입장에서 본 신의 한 수 크리에이티브/매체 기획 요인)",
    "weaknesses": "한계점 및 향후 극복 과제 (향후 캠페인 확장 또는 보완할 리스크 관리 포인트)",
    "lessons": "AE 실무 벤치마킹 레슨 (향후 유사한 F&B, 테크, OOH 캠페인을 기획할 때 적용 가능한 실무 법칙)"
  }}
}}
"""

def analyze_ad_with_gemini(ad_info: dict, api_key: str) -> dict:
    
    prompt = PROMPT_TEMPLATE.format(
        title=ad_info["title"],
        brand=ad_info["brand"],
        source=ad_info.get("source", "정보 없음"),
        media=ad_info.get("media", "정보 없음"),
        industry=ad_info.get("industry", "정보 없음"),
        date=ad_info.get("date", "정보 없음"),
        story=ad_info.get("story", "정보 없음")
    )
    
    try:
        client = genai.Client(api_key=api_key, http_options=types.HttpOptions(api_version='v1beta'))
        config = types.GenerateContentConfig(response_mime_type='application/json')
        response = generate_content_with_retry(client, 'gemini-3.5-flash', prompt, config)
        
        result = json.loads(response.text.strip())
        result["image"] = ad_info["image"]
        yt_url = get_youtube_link(ad_info["brand"], ad_info["title"], ad_info["url"])
        result["url"] = yt_url
        result["id"] = ad_info["id"]
        result["source"] = ad_info.get("source", "TVCF")
        if "client" not in result:
            result["client"] = ad_info.get("client") or ad_info["brand"]
        if "brand" not in result:
            result["brand"] = ad_info["brand"]
        if "agency" not in result:
            result["agency"] = ad_info.get("source") or ad_info.get("agency") or "TVCF"
        return result
    except Exception as e:
        print(f"Gemini API Error: {e}")
        yt_url = get_youtube_link(ad_info["brand"], ad_info["title"], ad_info["url"])
        return {
            "id": ad_info["id"],
            "title": ad_info["title"],
            "client": ad_info.get("client") or ad_info["brand"],
            "brand": ad_info["brand"],
            "agency": ad_info.get("source", "TVCF"),
            "onair_date": ad_info.get("date", "정보 없음"),
            "image": ad_info["image"],
            "url": yt_url,
            "source": ad_info.get("source", "TVCF"),
            "intent": {
                "background": "Gemini API 분석 실패. API Key와 네트워크 상태를 검토하세요.",
                "objective": "오류: " + str(e)
            },
            "target_perception": {
                "primary": "N/A",
                "before": "N/A",
                "after": "N/A",
                "shift_point": "N/A"
            },
            "response": {
                "sentiment_positive": 50,
                "sentiment_neutral": 50,
                "sentiment_negative": 0,
                "real_reactions": ["API 로드 오류"],
                "viral_factor": "N/A"
            },
            "ae_takeaway": {
                "strengths": "N/A",
                "weaknesses": "N/A",
                "lessons": "N/A"
            }
        }

# API Endpoints
@app.get("/api/ads")
def get_ads(
    q: Optional[str] = Query(None),
    brand: Optional[str] = Query(None),
    source: Optional[str] = Query(None),
    category: Optional[str] = Query(None), # Added category filter (영상, OOH, 사진)
    page: int = Query(1, ge=1),
    limit: int = Query(12, ge=1)
):
    filtered_ads = ALL_ADS
    
    if category and category != "":
        filtered_ads = [ad for ad in filtered_ads if ad.get("media_category") == category]
        
    if source and source != "":
        filtered_ads = [ad for ad in filtered_ads if ad["source"] == source]
        
    if q:
        q_lower = q.lower()
        filtered_ads = [ad for ad in filtered_ads if q_lower in ad["title"].lower() or q_lower in ad["brand"].lower()]
        
    if brand:
        filtered_ads = [ad for ad in filtered_ads if brand == ad["brand"]]
        
    start = (page - 1) * limit
    end = start + limit
    paginated = filtered_ads[start:end]
    
    brands = sorted(list(set(ad["brand"] for ad in ALL_ADS)))
    sources = sorted(list(set(ad["source"] for ad in ALL_ADS if ad.get("source"))))
    
    return {
        "total": len(filtered_ads),
        "page": page,
        "limit": limit,
        "ads": paginated,
        "brands": brands[:40],
        "sources": sources
    }

class AnalysisRequest(BaseModel):
    ad_id: str
    custom_url: Optional[str] = None

@app.post("/api/analyze")
def analyze_ad(request: AnalysisRequest, x_gemini_api_key: Optional[str] = Header(None)):
    header_key = x_gemini_api_key
    if not x_gemini_api_key or x_gemini_api_key.strip() == "":
        x_gemini_api_key = get_server_api_key()
        
    if not x_gemini_api_key or x_gemini_api_key.strip() == "":
        raise HTTPException(
            status_code=400, 
            detail="설정(Settings)에서 Gemini API Key를 먼저 입력해 주세요."
        )
    
    if header_key and header_key.strip() != "":
        try:
            config = load_config()
            if config.get("gemini_api_key") != header_key:
                config["gemini_api_key"] = header_key
                save_config(config)
                print("Successfully auto-saved Gemini API Key to server_config.json")
        except Exception as e:
            print(f"Error auto-saving key: {e}")
    
    cache = load_cache()
    
    # Check if this ID belongs to agency curated ads
    matched_agency = [ad for ad in AGENCY_ADS if ad["id"] == request.ad_id]
    if matched_agency:
        # Re-run if cached data has old schema
        is_old_schema = False
        if request.ad_id in cache:
            cached_data = cache[request.ad_id]
            if "target_perception" not in cached_data:
                is_old_schema = True
                
        if request.ad_id in cache and not is_old_schema:
            cached_data = cache[request.ad_id]
            is_failed = cached_data.get("target_perception", {}).get("before") == "N/A" or "실패" in cached_data.get("intent", {}).get("background", "")
            if not is_failed:
                old_url = cached_data.get("url", "")
                if old_url and "tvcf.co.kr" in old_url.lower():
                    new_url = get_youtube_link(cached_data.get("brand", ""), cached_data.get("title", ""), old_url)
                    if new_url != old_url:
                        cached_data["url"] = new_url
                        cache[request.ad_id] = cached_data
                        save_cache(cache)
                print(f"Returning cached analysis for {request.ad_id}")
                return cached_data
            
        ad_info = matched_agency[0]
        print(f"Analyzing agency ad: {ad_info['title']}")
        analysis_result = analyze_ad_with_gemini(ad_info, x_gemini_api_key)
        
        if analysis_result.get("target_perception", {}).get("before") != "N/A":
            cache[request.ad_id] = analysis_result
            save_cache(cache)
        return analysis_result
        
    # Check cache for TVCF ad
    if request.ad_id in cache:
        cached_data = cache[request.ad_id]
        if "target_perception" in cached_data:
            is_failed = cached_data.get("target_perception", {}).get("before") == "N/A" or "실패" in cached_data.get("intent", {}).get("background", "")
            if not is_failed:
                old_url = cached_data.get("url", "")
                if old_url and "tvcf.co.kr" in old_url.lower():
                    new_url = get_youtube_link(cached_data.get("brand", ""), cached_data.get("title", ""), old_url)
                    if new_url != old_url:
                        cached_data["url"] = new_url
                        cache[request.ad_id] = cached_data
                        save_cache(cache)
                print(f"Returning cached analysis for {request.ad_id}")
                return cached_data
            
    # Otherwise, it is a TVCF link (scrape)
    url = request.custom_url
    if url:
        url = url.strip()
        if url.startswith("https//"):
            url = "https://" + url[7:]
        elif url.startswith("http//"):
            url = "http://" + url[6:]
    else:
        matched = [ad for ad in ALL_ADS if ad["id"] == request.ad_id]
        if matched:
            url = matched[0]["url"]
        else:
            url = f"https://tvcf.co.kr/play/{request.ad_id}"
            
    print(f"Scraping: {url}")
    scraped_info = scrape_ad(url)
    
    print(f"Analyzing with Gemini API...")
    analysis_result = analyze_ad_with_gemini(scraped_info, x_gemini_api_key)
    
    if analysis_result.get("target_perception") and analysis_result["target_perception"].get("before") != "N/A":
        cache[request.ad_id] = analysis_result
        save_cache(cache)
        
    return analysis_result

@app.get("/api/analyzed-list")
def get_analyzed_list():
    cache = load_cache()
    summary_list = []
    for ad_id, data in cache.items():
        match_score = 90
        if "target_perception" in data:
            match_score = data.get("target_perception", {}).get("match_score", 95)
        elif "target" in data:
            match_score = data.get("target", {}).get("match_score", 90)
            
        summary_list.append({
            "id": ad_id,
            "title": data.get("title"),
            "brand": data.get("brand"),
            "image": data.get("image"),
            "source": data.get("source", "TVCF"),
            "onair_date": data.get("onair_date"),
            "match_score": match_score,
            "sentiment_positive": data.get("response", {}).get("sentiment_positive")
        })
    return summary_list[::-1]

# Realtime Trend Scrapers (Nate Trends & Careet MZ Trends)
@app.get("/api/trends/realtime")
def get_realtime_trends():
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    try:
        r = requests.get("https://www.nate.com", headers=headers, timeout=5)
        if r.status_code != 200:
            raise Exception("Failed to reach Nate")
        
        soup = BeautifulSoup(r.text, "html.parser")
        keywords = []
        for a in soup.find_all("a"):
            href = a.get("href", "")
            if "search" in href and "q=" in href:
                text = a.get_text().strip()
                if text and len(text) < 15 and text not in keywords:
                    keywords.append(text)
        return {"status": "success", "trends": keywords[:10]}
    except Exception as e:
        print(f"Error fetching Nate trends: {e}")
        return {
            "status": "success", 
            "trends": ["MZ세대", "숏폼 챌린지", "AI 크리에이티브", "인공지능", "ESG 경영", "팝업 스토어", "복고 감성", "캐릭터 마케팅", "유튜브 리뷰", "인플루언서"]
        }

@app.get("/api/trends/careet")
def get_careet_trends():
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    try:
        r = requests.get("https://www.careet.net/", headers=headers, timeout=8)
        if r.status_code != 200:
            raise Exception("Failed to reach Careet")
            
        soup = BeautifulSoup(r.text, "html.parser")
        articles = []
        for a in soup.find_all("a"):
            href = a.get("href", "")
            if href.startswith("/") and href[1:].isdigit():
                url = "https://www.careet.net" + href
                
                raw_text = a.get_text().strip()
                lines = [line.strip() for line in raw_text.split("\n") if line.strip()]
                title = lines[0] if lines else "제목 없음"
                desc = " ".join(lines[1:]) if len(lines) > 1 else ""
                
                title = re.sub(r'\s+', ' ', title).strip()
                desc = re.sub(r'\s+', ' ', desc).strip()
                if len(desc) > 80:
                    desc = desc[:77] + "..."
                    
                img = a.find("img")
                img_url = img.get("src") if img else ""
                if img_url and img_url.startswith("/"):
                    img_url = "https://www.careet.net" + img_url
                    
                if title and len(title) > 5 and not any(art["url"] == url for art in articles):
                    articles.append({
                        "title": title,
                        "desc": desc,
                        "image": img_url,
                        "url": url
                    })
        return {"status": "success", "articles": articles[:5]}
    except Exception as e:
        print(f"Error fetching Careet: {e}")
        return {
            "status": "success",
            "articles": [
                {
                    "title": "요즘 Z세대가 카카오톡 대신 DM으로 소통하는 이유",
                    "desc": "Z세대 소셜 네트워킹 핵심 트렌드 분석",
                    "image": "https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=300&q=80",
                    "url": "https://www.careet.net"
                },
                {
                    "title": "팝업스토어 피로증을 극복하는 3가지 이색 마케팅 사례",
                    "desc": "체험형 마케팅의 질적 전환 트렌드",
                    "image": "https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=300&q=80",
                    "url": "https://www.careet.net"
                }
            ]
        }

class SettingsRequest(BaseModel):
    gemini_api_key: str

@app.post("/api/settings/save-key")
def save_settings_key(request: SettingsRequest):
    config = load_config()
    config["gemini_api_key"] = request.gemini_api_key
    save_config(config)
    
    # Generate daily briefing in a separate thread
    threading.Thread(target=generate_daily_morning_briefing, daemon=True).start()
    return {"status": "success", "message": "API Key saved on server."}

@app.post("/api/settings/clear-key")
def clear_settings_key():
    config = load_config()
    if "gemini_api_key" in config:
        del config["gemini_api_key"]
    save_config(config)
    return {"status": "success", "message": "API Key cleared from server."}

@app.get("/api/settings/status")
def get_settings_status():
    key = get_server_api_key()
    return {"has_key": len(key) > 0}

def scrape_naver_datalab() -> List[str]:
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    keywords = []
    try:
        res = requests.get("https://datalab.naver.com/shopping/category.naver", headers=headers, timeout=5)
        if res.status_code == 200:
            soup = BeautifulSoup(res.text, "html.parser")
            for rank_list in soup.find_all("ul", class_="rank_list"):
                for li in rank_list.find_all("li"):
                    txt = li.get_text().strip()
                    clean_txt = re.sub(r'^\d+\s+', '', txt).strip()
                    if clean_txt and clean_txt not in keywords:
                        keywords.append(clean_txt)
    except Exception as e:
        print(f"Error scraping Naver DataLab: {e}")
        
    fallbacks = [
        "온디바이스 AI", "팝업 스토어", "친환경 가치소비", "디토 소비", "숏폼 챌린지", 
        "레트로 Y2K 감성", "체험형 브랜드 매장", "러닝 코칭 크리에이티브", "짠테크 소비", "K-뷰티 메가팝업",
        "로컬 라이프 스타일", "디지털 디톡스", "AI 코빌리티", "헬시 플레저", "브랜디드 숏 비디오"
    ]
    for fb in fallbacks:
        if len(keywords) >= 10:
            break
        if fb not in keywords:
            keywords.append(fb)
            
    return keywords[:10]

@app.get("/api/trends/naver-datalab")
def get_naver_datalab_trends():
    trends = scrape_naver_datalab()
    return {"status": "success", "trends": trends}

@app.get("/api/trends/morning-briefing")
def get_morning_briefing():
    current_date = time.strftime("%Y-%m-%d")
    
    if not os.path.exists(MORNING_BRIEFING_PATH):
        generate_daily_morning_briefing()
        if not os.path.exists(MORNING_BRIEFING_PATH):
            generate_fallback_briefing(current_date)
    else:
        try:
            with open(MORNING_BRIEFING_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                if data.get("date") != current_date:
                    generate_daily_morning_briefing()
                    # Double check if date updated
                    with open(MORNING_BRIEFING_PATH, "r", encoding="utf-8") as f2:
                        updated_data = json.load(f2)
                        if updated_data.get("date") != current_date:
                            generate_fallback_briefing(current_date)
        except Exception:
            generate_fallback_briefing(current_date)
            
    if os.path.exists(MORNING_BRIEFING_PATH):
        try:
            with open(MORNING_BRIEFING_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
            
    raise HTTPException(status_code=500, detail="Morning briefing not available.")

# Start background workers immediately
start_background_workers()

# Mount static frontend
static_dir = os.path.join(BASE_DIR, "static")
if not os.path.exists(static_dir):
    os.makedirs(static_dir)

app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
def read_root():
    index_path = os.path.join(BASE_DIR, "static", "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return JSONResponse({"status": "error", "message": "Frontend static/index.html not built yet."})

if __name__ == "__main__":
    import uvicorn
    import socket
    
    hostname = socket.gethostname()
    local_ips = []
    try:
        addr_infos = socket.getaddrinfo(hostname, None)
        for info in addr_infos:
            ip = info[4][0]
            if ":" not in ip and not ip.startswith("127."):
                if ip not in local_ips:
                    local_ips.append(ip)
    except Exception:
        pass
        
    print("\n" + "="*60)
    print("[Mobile Access Info] 모바일 기기(휴대폰) 접속 방법 안내:")
    print("컴퓨터와 휴대폰이 같은 와이파이(Wi-Fi)에 연결되어 있어야 합니다.")
    print("휴대폰 브라우저 창에 아래 주소 중 하나를 입력해 접속하세요:")
    for ip in local_ips:
        print(f"  * http://{ip}:8000")
    print("="*60 + "\n")
    
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
