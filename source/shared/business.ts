export const businessTypes = {
  barber: { name: "Барбершоп", specialist: "Мастер", anyone: "Любой мастер" },
  auto: { name: "Автосервис", specialist: "Специалист", anyone: "Любой специалист" },
  tutor: { name: "Обучение", specialist: "Преподаватель", anyone: "Любой преподаватель" },
  other: { name: "Другая сфера услуг", specialist: "Специалист", anyone: "Любой специалист" },
} as const;
export type BusinessType = keyof typeof businessTypes;
