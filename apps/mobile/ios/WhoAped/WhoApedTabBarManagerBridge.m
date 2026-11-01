#import <React/RCTViewManager.h>

@interface RCT_EXTERN_REMAP_MODULE(WhoApedTabBar, WhoApedTabBarManager, RCTViewManager)

RCT_EXPORT_VIEW_PROPERTY(selectedIndex, NSInteger)
RCT_EXPORT_VIEW_PROPERTY(darkMode, BOOL)
RCT_EXPORT_VIEW_PROPERTY(onTabSelected, RCTDirectEventBlock)

@end
