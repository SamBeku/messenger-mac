import SwiftUI

/// One category of Facebook's emoji catalog (read from its picker by readEmojiCatalog in bridge.js).
struct EmojiCategory: Codable, Identifiable {
    let name: String
    let emoji: [String]
    var id: String { name }
}

/// The customizer's state. The catalog can arrive after the sheet opens (it's read once, then kept).
@MainActor
final class ReactionCustomizerModel: ObservableObject {
    static let maxCount = 10
    static let defaults = ["❤️", "😆", "😮", "😢", "👍"]

    @Published var reactions: [String]
    @Published var catalog: [EmojiCategory]?

    init(reactions: [String], catalog: [EmojiCategory]?) {
        self.reactions = reactions
        self.catalog = catalog
    }
}

/// Customize Reactions (the "+" in the message menu): 1–10 quick reactions, 5 per line,
/// picked from Facebook's emoji catalog, with search.
struct ReactionCustomizer: View {
    @ObservedObject var model: ReactionCustomizerModel
    /// The new list, or nil when cancelled.
    let onDone: ([String]?) -> Void

    @State private var selected: Int? = 0
    @State private var adding = false
    @State private var query = ""

    private static let perLine = 5
    private static let categoryIcons = [
        "face.smiling", "pawprint", "fork.knife", "soccerball", "car", "lightbulb", "heart", "flag",
    ]
    private let columns = Array(repeating: GridItem(.fixed(34), spacing: 6), count: 10)

    var body: some View {
        VStack(spacing: 16) {
            Text("Customize Reactions").font(.title3.weight(.semibold))
            slots
            HStack(spacing: 10) {
                Button { startAdding() } label: { Label("Add", systemImage: "plus") }
                    .disabled(model.reactions.count >= ReactionCustomizerModel.maxCount)
                Button { removeSelected() } label: { Label("Remove", systemImage: "minus") }
                    .disabled(model.reactions.count <= 1 || selected == nil)
            }
            .controlSize(.small)
            Text(adding ? "Choose an emoji to add." : "Click a reaction, then choose an emoji to replace it.")
                .font(.callout)
                .foregroundStyle(.secondary)
            searchField
            emojiGrid
            HStack {
                Button("Reset") { reset() }
                Spacer()
                Button("Cancel") { onDone(nil) }.keyboardShortcut(.cancelAction)
                Button("Save") { onDone(model.reactions) }
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent)
            }
        }
        .padding(24)
        .frame(width: 480)
    }

    // MARK: Reactions being edited

    /// The reactions, 5 per line, centred; while adding, a dashed spot shows where the new one goes.
    private var slots: some View {
        let count = model.reactions.count + (adding ? 1 : 0)
        let lines = stride(from: 0, to: count, by: Self.perLine).map { Array($0..<min($0 + Self.perLine, count)) }
        return VStack(spacing: 8) {
            ForEach(lines, id: \.self) { line in
                HStack(spacing: 8) {
                    ForEach(line, id: \.self) { index in
                        if index < model.reactions.count { slot(index) } else { newSlot }
                    }
                }
            }
        }
        // Selecting, adding, removing and swapping glide instead of jumping.
        .animation(.snappy(duration: 0.22), value: model.reactions)
        .animation(.snappy(duration: 0.22), value: selected)
        .animation(.snappy(duration: 0.22), value: adding)
    }

    private func slot(_ index: Int) -> some View {
        let isSelected = selected == index && !adding
        return Text(model.reactions[index])
            .font(.system(size: 28))
            .frame(width: 46, height: 46)
            .background(RoundedRectangle(cornerRadius: 12)
                .fill(isSelected ? Color.accentColor.opacity(0.22) : Color.primary.opacity(0.06)))
            .overlay(RoundedRectangle(cornerRadius: 12)
                .strokeBorder(isSelected ? Color.accentColor : .clear, lineWidth: 2))
            .contentShape(Rectangle())
            .onTapGesture {
                selected = index
                adding = false
            }
    }

    private var newSlot: some View {
        Image(systemName: "plus")
            .foregroundStyle(Color.accentColor)
            .frame(width: 46, height: 46)
            .overlay(RoundedRectangle(cornerRadius: 12)
                .strokeBorder(Color.accentColor, style: StrokeStyle(lineWidth: 2, dash: [5, 4])))
    }

    private func startAdding() {
        adding = true
        selected = nil
    }

    private func removeSelected() {
        guard let index = selected, model.reactions.count > 1 else { return }
        model.reactions.remove(at: index)
        selected = min(index, model.reactions.count - 1)
    }

    private func reset() {
        model.reactions = ReactionCustomizerModel.defaults
        selected = 0
        adding = false
    }

    /// Fills the chosen spot. An emoji that is already a reaction swaps places instead of repeating.
    private func pick(_ emoji: String) {
        if adding {
            if let existing = model.reactions.firstIndex(of: emoji) {
                selected = existing
            } else {
                model.reactions.append(emoji)
                selected = model.reactions.count - 1
            }
            adding = false
        } else if let index = selected {
            if let other = model.reactions.firstIndex(of: emoji), other != index {
                model.reactions.swapAt(index, other)
            } else {
                model.reactions[index] = emoji
            }
        }
    }

    // MARK: Emoji catalog

    private var searchField: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
            TextField("Search emoji", text: $query).textFieldStyle(.plain)
            if !query.isEmpty {
                Button { query = "" } label: { Image(systemName: "xmark.circle.fill") }
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.07)))
        .frame(width: 394)
    }

    private var emojiGrid: some View {
        Group {
            if let catalog = model.catalog {
                ScrollViewReader { proxy in
                    VStack(spacing: 10) {
                        ScrollView {
                            let shown = sections(of: catalog)
                            if shown.isEmpty {
                                Text("No emoji found").foregroundStyle(.secondary).padding(.top, 40)
                            }
                            LazyVGrid(columns: columns, spacing: 6, pinnedViews: [.sectionHeaders]) {
                                ForEach(shown) { section in
                                    Section {
                                        ForEach(section.emoji, id: \.self) { emoji in
                                            Button { pick(emoji) } label: {
                                                Text(emoji).font(.system(size: 24)).frame(width: 34, height: 34)
                                            }
                                            .buttonStyle(EmojiButtonStyle())
                                        }
                                    } header: {
                                        Text(section.name)
                                            .font(.caption.weight(.semibold))
                                            .foregroundStyle(.secondary)
                                            .frame(maxWidth: .infinity, alignment: .leading)
                                            .padding(.vertical, 4)
                                            .background(Color(nsColor: .windowBackgroundColor))
                                    }
                                    .id(section.name)
                                }
                            }
                            .frame(width: 394)
                        }
                        .frame(height: 290)

                        // Jump to a category, like the tabs under Facebook's picker.
                        if query.isEmpty {
                            HStack(spacing: 18) {
                                ForEach(Array(catalog.enumerated()), id: \.element.id) { index, category in
                                    Button { withAnimation(.smooth(duration: 0.35)) { proxy.scrollTo(category.name, anchor: .top) } } label: {
                                        Image(systemName: Self.categoryIcons[min(index, Self.categoryIcons.count - 1)])
                                    }
                                    .buttonStyle(.plain)
                                    .foregroundStyle(.secondary)
                                    .help(category.name)
                                }
                            }
                        }
                    }
                }
            } else {
                ProgressView("Loading emoji…").frame(height: 318)
            }
        }
    }

    private func sections(of catalog: [EmojiCategory]) -> [EmojiCategory] {
        let words = query.lowercased().split(separator: " ")
        guard !words.isEmpty else { return catalog }
        let matches = catalog.flatMap(\.emoji).filter { emoji in
            let name = EmojiNames.name(for: emoji)
            return words.allSatisfy { name.contains($0) }
        }
        return matches.isEmpty ? [] : [EmojiCategory(name: "Results", emoji: matches)]
    }
}

/// An emoji in the grid: a soft highlight on hover.
private struct EmojiButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        Highlighted(configuration: configuration)
    }

    private struct Highlighted: View {
        let configuration: Configuration
        @State private var hovered = false

        var body: some View {
            configuration.label
                .background(RoundedRectangle(cornerRadius: 8)
                    .fill(Color.primary.opacity(configuration.isPressed ? 0.18 : hovered ? 0.1 : 0)))
                .animation(.easeOut(duration: 0.12), value: hovered)
                .onHover { hovered = $0 }
        }
    }
}

/// Searchable names for emoji: Unicode's names ("face with tears of joy"), and country names for flags.
@MainActor
enum EmojiNames {
    private static var cache: [String: String] = [:]

    static func name(for emoji: String) -> String {
        if let cached = cache[emoji] { return cached }
        let name = flagName(emoji) ?? unicodeName(emoji)
        cache[emoji] = name
        return name
    }

    private static func flagName(_ emoji: String) -> String? {
        let letters = emoji.unicodeScalars.compactMap { scalar -> Character? in
            guard (0x1F1E6...0x1F1FF).contains(scalar.value) else { return nil }
            return Character(UnicodeScalar(scalar.value - 0x1F1E6 + 65)!)
        }
        guard letters.count == 2, let country = Locale.current.localizedString(forRegionCode: String(letters)) else { return nil }
        return "\(country) flag".lowercased()
    }

    /// The transform gives "\N{THUMBS UP SIGN}\N{EMOJI MODIFIER FITZPATRICK TYPE-4}"; keep the
    /// meaningful names and drop joiners, variation selectors and skin tones.
    private static func unicodeName(_ emoji: String) -> String {
        let text = NSMutableString(string: emoji)
        CFStringTransform(text, nil, kCFStringTransformToUnicodeName, false)
        let names = (text as String).components(separatedBy: "{").dropFirst()
            .compactMap { $0.split(separator: "}").first.map(String.init) }
            .filter { !$0.hasPrefix("VARIATION SELECTOR") && !$0.hasPrefix("EMOJI MODIFIER")
                && $0 != "ZERO WIDTH JOINER" && $0 != "COMBINING ENCLOSING KEYCAP" }
        return names.joined(separator: " ").lowercased()
    }
}
