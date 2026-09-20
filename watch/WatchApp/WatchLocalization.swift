import Foundation

struct WatchLocalizer {
  let identifier: String
  let locale: Locale
  private let selectedBundle: Bundle
  private let englishBundle: Bundle?

  init(identifier: String, formattingIdentifier: String? = nil, container: Bundle = .main) {
    let catalog = WatchLocale.canonical(identifier) ?? "en"
    self.identifier = catalog
    locale = Locale(identifier: WatchLocale.canonicalFormatting(formattingIdentifier, for: catalog)
      ?? WatchLocale.defaultFormattingIdentifiers[catalog] ?? "en-AU")
    englishBundle = container.path(forResource: "en", ofType: "lproj").flatMap(Bundle.init(path:))
    selectedBundle = container.path(forResource: self.identifier, ofType: "lproj")
      .flatMap(Bundle.init(path:)) ?? englishBundle ?? container
  }

  private func format(for key: String) -> String {
    let fallback = englishBundle?.localizedString(forKey: key, value: key, table: nil) ?? key
    return selectedBundle.localizedString(forKey: key, value: fallback, table: nil)
  }

  func string(_ key: String, arguments: [CVarArg] = []) -> String {
    let value = format(for: key)
    guard !arguments.isEmpty else { return value }
    return String(format: value, locale: locale, arguments: arguments)
  }

  func plural(_ key: String, count: Int) -> String {
    let arguments: [CVarArg] = [Int64(count)]
    return String(format: format(for: key), locale: locale, arguments: arguments)
  }
}
