// Existing device/motion suites use a synthetic contact. Onboarding itself is
// exercised from an empty browser in notifications-browser.cjs.
exports.seedContact = function seedContact() {
  if (!localStorage.getItem("smarttrack.contact.browser.v1")) localStorage.setItem("smarttrack.contact.browser.v1", JSON.stringify({
    id: "11111111-1111-4111-8111-111111111111", token: "a".repeat(64),
    profile: { name: "Synthetic Visitor", email: "visitor@example.com", phone: "+12025550123" },
    preferences: { general: { enabled: false, minutes: 60 }, journey: { enabled: false, minutes: 30 } },
  }));
};
