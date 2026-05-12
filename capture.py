import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        await page.goto("http://127.0.0.1:3000/test_bubbles.html")
        await page.wait_for_timeout(500)
        await page.locator("#chat-container").screenshot(path="/home/jules/verification/screenshots/verification2.png")
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
