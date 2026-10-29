import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";

test("plain HTTP LAN supports pairing copy and viewer actions without secure-context browser APIs", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Try creator simulator" }).click();
  const pairing = page.waitForResponse(
    (r) =>
      r.url().endsWith("/v1/creator/mobile-token") &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Pair native AR + share composed video" })
    .click();
  const pair = await pairing;
  expect(pair.status()).toBe(200);
  const { token } = await pair.json();
  const environment = await page.evaluate(() => ({
    secureContext: isSecureContext,
    uuid: typeof crypto.randomUUID,
    clipboard: typeof navigator.clipboard,
  }));
  if (!baseURL?.includes("127.0.0.1")) {
    expect(environment.secureContext).toBe(false);
    expect(environment.uuid).toBe("undefined");
  }
  await page.locator("#copy-mobile-token").click();
  await expect(
    page.getByText("Pairing token copied. Keep it private.", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "artifacts/lan-native-pairing.png" });
  const viewer = await browser.newContext({ baseURL });
  try {
    const controller = await viewer.newPage();
    await controller.goto("/controller?room=demo-world");
    const login = controller.getByRole("button", {
      name: "Try viewer simulator",
    });
    if (await login.isVisible()) await login.click();
    const action = controller.waitForResponse(
      (r) => r.url().endsWith("/actions") && r.request().method() === "POST",
    );
    await controller.getByRole("button", { name: /^sit$/i }).click();
    const result = await action;
    expect(result.status(), await result.text()).toBe(200);
    expect(result.request().postDataJSON().clientRequestId).toMatch(
      /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/,
    );
    await expect
      .poll(async () => {
        const snapshot = await page.request.get("/v1/native/world", {
          headers: { Authorization: `Bearer ${token}` },
        });
        expect(snapshot.status()).toBe(200);
        return (await snapshot.json()).avatars.find(
          (a: { name: string }) => a.name === "Mossling",
        )?.animation;
      })
      .toBe("sit");
    await writeFile(
      "artifacts/lan-browser-qa.json",
      JSON.stringify(
        {
          origin: baseURL,
          ...environment,
          pairingCopyPassed: true,
          viewerActionAccepted: true,
          nativeSnapshotAnimation: "sit",
          scope:
            "Actual laptop HTTP LAN browser/API flow; physical Android test remains open",
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    await viewer.close();
  }
});
