"""
SERP HTML parsers — ported from Desktop/api.py (BeautifulSoup).
Purpose: Turn Google results HTML into organic/ads/AI overview/PASF JSON.
"""

from __future__ import annotations

from urllib.parse import parse_qs, urlparse

from bs4 import BeautifulSoup


def extract_sponsored_results(soup: BeautifulSoup) -> list:
    sponsored = []
    position = 0

    def process_ad_block(block):
        nonlocal position
        link = block.find("a", href=True)
        if not link:
            return
        url = link.get("href", "")
        if not (url.startswith("/aclk") or url.startswith("http")):
            return

        position += 1
        title_tag = (
            block.find("div", class_=lambda x: x and "CCgQ5" in x)
            or block.find("span", attrs={"role": "heading"})
            or block.find("div", attrs={"role": "heading"})
        )
        title = title_tag.get_text(strip=True) if title_tag else link.get_text(strip=True)

        cite = block.find("cite") or block.find("span", class_="VuuXrf")
        display_url = cite.get_text(strip=True) if cite else ""

        snippet_tag = block.find("div", class_=lambda x: x and ("MUxGbd" in x or "yDYNvb" in x))
        snippet = snippet_tag.get_text(" ", strip=True) if snippet_tag else ""

        if url.startswith("/aclk"):
            parsed = parse_qs(urlparse(url).query)
            url = parsed.get("adurl", [url])[0]

        sponsored.append(
            {
                "position": position,
                "title": title,
                "url": url,
                "site_name": display_url.split(" ")[0] if display_url else "",
                "display_url": display_url,
                "snippet": snippet,
            }
        )

    tads = soup.find("div", id="tads")
    if tads:
        ad_blocks = (
            tads.find_all("div", class_=lambda x: x and "uEierd" in x)
            or tads.find_all("div", attrs={"data-text-ad": "1"})
            or tads.find_all("div", recursive=False)
        )
        for block in ad_blocks:
            process_ad_block(block)

    tadsb = soup.find("div", id="tadsb")
    if tadsb:
        for block in tadsb.find_all("div", recursive=False):
            process_ad_block(block)

    return sponsored


def extract_ai_overview(soup: BeautifulSoup) -> dict:
    ai_data = {"available": False, "heading": "", "sections": [], "sources": []}

    not_available = soup.find("span", {"jsname": "lGsj1"})
    if not_available and "display:none" not in (not_available.get("style") or ""):
        return ai_data

    ai_container = soup.find("div", id=lambda x: x and str(x).startswith("B2Jtyd"))
    if not ai_container:
        ai_container = soup.find("div", class_=lambda x: x and "EyBRub" in str(x))
    if not ai_container:
        return ai_data

    heading_tag = (
        ai_container.find("div", class_="cUzNTd")
        or ai_container.find("div", class_="Fzsovc")
        or soup.find("div", class_="cUzNTd")
    )
    if heading_tag:
        ai_data["heading"] = heading_tag.get_text(strip=True)

    if not ai_data["heading"]:
        for tag in ai_container.find_all(["div", "span"]):
            txt = tag.get_text(strip=True)
            if txt.lower() in ("ai overview", "ai overviews"):
                ai_data["heading"] = txt
                break

    if not ai_data["heading"]:
        return ai_data

    ai_data["available"] = True

    for block in ai_container.find_all("div", class_="n6owBd"):
        text = block.get_text(" ", strip=True)
        if text:
            ai_data["sections"].append({"type": "text", "content": text})

    seen_urls = set()
    for link in ai_container.find_all("a", class_="muU3oe"):
        href = link.get("href", "")
        if href and href not in seen_urls:
            seen_urls.add(href)
            ai_data["sources"].append(href)

    return ai_data


def extract_people_also_search_for(soup: BeautifulSoup) -> dict:
    pasf = {"available": False, "heading": "", "results": []}
    bres = soup.find("div", id="bres")
    if not bres:
        return pasf

    heading_tag = bres.find(["span", "div"], class_=lambda x: x and "mgAbYb" in str(x))
    if heading_tag:
        pasf["heading"] = heading_tag.get_text(" ", strip=True)

    cards = bres.find_all("a", class_=lambda x: x and "ngTNl" in str(x))
    seen = set()
    position = 0
    for card in cards:
        href = card.get("href", "")
        if not href:
            continue
        text_tag = card.find("span", class_=lambda x: x and "dg6jd" in str(x))
        query = text_tag.get_text(" ", strip=True) if text_tag else ""
        if not query or query in seen:
            continue
        seen.add(query)
        position += 1
        pasf["results"].append(
            {
                "position": position,
                "query": query,
                "url": href if href.startswith("http") else f"https://www.google.com{href}",
            }
        )

    if pasf["results"]:
        pasf["available"] = True
    return pasf


def parse_html(html: str) -> dict:
    """Parse raw Google SERP HTML into the same shape as Desktop/api.py."""
    soup = BeautifulSoup(html, "html.parser")
    ai_overview = extract_ai_overview(soup)
    sponsored = extract_sponsored_results(soup)
    pasf = extract_people_also_search_for(soup)

    all_data = []
    results = soup.find_all("div", class_=lambda x: x and "tF2Cxc" in x)
    for idx, result in enumerate(results, start=1):
        if len(all_data) >= 50:
            break
        link_tag = result.find("a", href=True)
        url = link_tag.get("href") if link_tag else ""
        if url.startswith("/url?"):
            parsed = parse_qs(urlparse(url).query)
            url = parsed.get("q", [""])[0]
        title_tag = result.find("h3")
        title = title_tag.get_text(strip=True) if title_tag else ""
        site_tag = result.find("span", class_="VuuXrf")
        cite_tag = result.find("cite")
        snippet_tag = result.find("div", class_="VwiC3b")
        snippet = ""
        if snippet_tag:
            for a in snippet_tag.find_all("a"):
                a.extract()
            snippet = snippet_tag.get_text(" ", strip=True)
        if title and url:
            all_data.append(
                {
                    "position": len(all_data) + 1,
                    "url": url,
                    "title": title,
                    "site_name": site_tag.get_text(strip=True) if site_tag else "",
                    "display_url": cite_tag.get_text(" ", strip=True) if cite_tag else "",
                    "snippet": snippet,
                }
            )

    return {
        "ai_overview": ai_overview,
        "sponsored_results": sponsored,
        "organic_results": all_data,
        "people_also_search_for": pasf,
    }
