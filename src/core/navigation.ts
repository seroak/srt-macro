interface NavigationPage {
  waitForNavigation(options: {
    waitUntil: "domcontentloaded";
    timeout: number;
  }): Promise<unknown>;
}

export async function runAndWaitForNavigation(
  page: NavigationPage,
  action: () => Promise<unknown>,
): Promise<void> {
  const navigation = page.waitForNavigation({
    waitUntil: "domcontentloaded",
    timeout: 15_000,
  });
  await action();
  await navigation;
}
