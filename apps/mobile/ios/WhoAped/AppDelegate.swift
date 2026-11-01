import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import Firebase

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    if Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil {
      FirebaseApp.configure()
    }

    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    return true
  }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard
      let windowScene = scene as? UIWindowScene,
      let appDelegate = UIApplication.shared.delegate as? AppDelegate,
      let factory = appDelegate.reactNativeFactory
    else { return }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window

    factory.startReactNative(
      withModuleName: "WhoAped",
      in: window,
      launchOptions: nil
    )
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}

@objc(WhoApedTabBarManager)
final class WhoApedTabBarManager: RCTViewManager {
  override class func requiresMainQueueSetup() -> Bool {
    true
  }

  override func view() -> UIView! {
    WhoApedTabBarView()
  }
}

@objc(WhoApedTabBarView)
final class WhoApedTabBarView: UIView, UITabBarDelegate {
  @objc var selectedIndex: Int = 0 {
    didSet {
      applySelectedIndex()
    }
  }

  @objc var darkMode: Bool = false {
    didSet {
      overrideUserInterfaceStyle = darkMode ? .dark : .light
    }
  }

  @objc var onTabSelected: RCTDirectEventBlock?

  private let tabBar = UITabBar()
  private lazy var tabItems: [UITabBarItem] = [
    makeItem(title: "Activity", symbol: "waveform.path.ecg", selectedSymbol: "waveform.path.ecg"),
    makeItem(title: "Wallets", symbol: "wallet.pass", selectedSymbol: "wallet.pass.fill"),
    makeItem(title: "Settings", symbol: "gearshape", selectedSymbol: "gearshape.fill"),
  ]

  override init(frame: CGRect) {
    super.init(frame: frame)
    configureTabBar()
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    configureTabBar()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    tabBar.frame = bounds
  }

  private func configureTabBar() {
    backgroundColor = .clear
    tabBar.items = tabItems
    tabBar.delegate = self
    tabBar.isTranslucent = true
    tabBar.tintColor = UIColor { traits in
      traits.userInterfaceStyle == .dark
        ? UIColor(red: 1, green: 0.416, blue: 0.314, alpha: 1)
        : UIColor(red: 0.941, green: 0.294, blue: 0.184, alpha: 1)
    }
    tabBar.unselectedItemTintColor = .secondaryLabel
    tabBar.accessibilityIdentifier = "main-tab-bar"
    addSubview(tabBar)

    applySelectedIndex()
  }

  func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
    guard let index = tabItems.firstIndex(of: item) else { return }
    selectedIndex = index
    UISelectionFeedbackGenerator().selectionChanged()
    onTabSelected?(["index": index])
  }

  private func applySelectedIndex() {
    guard !tabItems.isEmpty else { return }
    let index = min(max(selectedIndex, 0), tabItems.count - 1)
    tabBar.selectedItem = tabItems[index]
  }

  private func makeItem(title: String, symbol: String, selectedSymbol: String) -> UITabBarItem {
    let item = UITabBarItem(
      title: title,
      image: UIImage(systemName: symbol),
      selectedImage: UIImage(systemName: selectedSymbol)
    )
    item.accessibilityLabel = "\(title) tab"
    return item
  }
}
