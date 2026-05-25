import { test, expect } from '@playwright/test';

test('verify lesson content loads at /course/gt2/lesson/a', async ({ page }) => {
  const logs = [];
  page.on('console', (msg) => {
    logs.push(`[${msg.type()}] ${msg.text()}`);
  });

  await page.goto('http://localhost:5173/course/gt2/lesson/a', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  console.log('\n=== ALL CONSOLE LOGS ===');
  logs.forEach(l => console.log(l));

  const routeLogs = logs.filter(l => l.includes('[LessonContainer] Route matched'));
  const stepLoaderLogs = logs.filter(l => l.includes('step-loader'));
  const errorLogs = logs.filter(l => l.includes('[error]') || l.includes('[warning]') && (l.includes('Failed') || l.includes('Error')));

  console.log('\n=== ROUTE LOGS ===');
  console.log(`Route matched logs: ${routeLogs.length}`);
  routeLogs.forEach(l => console.log(l));

  console.log('\n=== STEP LOADER LOGS ===');
  console.log(`Step loader logs: ${stepLoaderLogs.length}`);
  stepLoaderLogs.forEach(l => console.log(l));

  console.log('\n=== ERROR LOGS ===');
  console.log(`Error logs: ${errorLogs.length}`);
  errorLogs.forEach(l => console.log(l));

  // DOM checks
  const chatMessages = await page.$('#chat-message-list');
  const chatContent = chatMessages ? await chatMessages.textContent() : '';
  console.log('\n=== DOM CHECKS ===');
  console.log(`#chat-message-list exists: ${!!chatMessages}`);
  console.log(`#chat-message-list has content: ${chatContent.trim().length > 0}`);

  const missionSection = await page.$('.mission-section, [class*="mission"], #mission');
  const missionExists = !!missionSection;
  const missionVisible = missionSection ? await missionSection.isVisible() : false;
  console.log(`Mission section exists: ${missionExists}`);
  console.log(`Mission section visible: ${missionVisible}`);

  const statsBar = await page.$('.stats-bar, [class*="stats"], .lesson-stats');
  const statsExists = !!statsBar;
  const statsVisible = statsBar ? await statsBar.isVisible() : false;
  console.log(`Stats bar exists: ${statsExists}`);
  console.log(`Stats bar visible: ${statsVisible}`);

  const stepContent = await page.$('.step-content, [class*="step"], #step-container');
  const stepExists = !!stepContent;
  const stepVisible = stepContent ? await stepContent.isVisible() : false;
  console.log(`Step content exists: ${stepExists}`);
  console.log(`Step content visible: ${stepVisible}`);

  // Store state
  const storeState = await page.evaluate(() => {
    if (!window.appStore) return null;
    const state = window.appStore.getState();
    return {
      currentStepIndex: state.currentStepIndex,
      lessonTitle: state.lessonTitle,
      loaded: state.loaded,
    };
  });
  console.log('\n=== STORE STATE ===');
  if (storeState) {
    console.log(`currentStepIndex: ${storeState.currentStepIndex}`);
    console.log(`lessonTitle: ${storeState.lessonTitle}`);
    console.log(`loaded: ${storeState.loaded}`);
  } else {
    console.log('window.appStore is not available!');
  }

  // Screenshot
  await page.screenshot({ path: 'tests/screenshots/verification-result.png', fullPage: true });
  console.log('\nScreenshot saved to tests/screenshots/verification-result.png');
});
