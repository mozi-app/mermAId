#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

extern void goShutdown(void);
extern void goOpenBrowser(void);

@interface MermaidAppDelegate : NSObject <NSApplicationDelegate, WKNavigationDelegate>
@property (strong) NSWindow *window;
@property (strong) WKWebView *webView;
@property (strong) NSString *serverURL;
@end

@implementation MermaidAppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
	NSRect frame = NSMakeRect(0, 0, 1280, 800);
	self.window = [[NSWindow alloc]
		initWithContentRect:frame
		          styleMask:(NSWindowStyleMaskTitled |
		                     NSWindowStyleMaskClosable |
		                     NSWindowStyleMaskMiniaturizable |
		                     NSWindowStyleMaskResizable)
		            backing:NSBackingStoreBuffered
		              defer:NO];
	[self.window setTitle:@"Mermaid Editor"];
	[self.window center];

	WKWebViewConfiguration *config = [[WKWebViewConfiguration alloc] init];
	self.webView = [[WKWebView alloc] initWithFrame:frame configuration:config];
	self.webView.navigationDelegate = self;
	[self.webView setAutoresizingMask:(NSViewWidthSizable | NSViewHeightSizable)];

	[self.window setContentView:self.webView];
	[self.window makeKeyAndOrderFront:nil];
	[NSApp activateIgnoringOtherApps:YES];

	NSURL *url = [NSURL URLWithString:self.serverURL];
	[self.webView loadRequest:[NSURLRequest requestWithURL:url]];
}

- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)flag {
	if (!flag) {
		[self.window makeKeyAndOrderFront:nil];
	}
	return YES;
}

- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)sender {
	goShutdown();
	return NSTerminateNow;
}

- (NSMenu *)applicationDockMenu:(NSApplication *)sender {
	NSMenu *menu = [[NSMenu alloc] init];
	[menu addItemWithTitle:@"Open in Browser"
	                action:@selector(openInBrowser:)
	         keyEquivalent:@""];
	return menu;
}

- (void)openInBrowser:(id)sender {
	goOpenBrowser();
}

// Open external links in system browser
- (void)webView:(WKWebView *)webView
	decidePolicyForNavigationAction:(WKNavigationAction *)navigationAction
	                decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
	NSURL *url = navigationAction.request.URL;
	if (navigationAction.navigationType == WKNavigationTypeLinkActivated &&
	    ![url.absoluteString hasPrefix:self.serverURL]) {
		[[NSWorkspace sharedWorkspace] openURL:url];
		decisionHandler(WKNavigationActionPolicyCancel);
		return;
	}
	decisionHandler(WKNavigationActionPolicyAllow);
}
@end

void runApp(const char *url) {
	@autoreleasepool {
		// Disable the macOS press-and-hold accent picker so that held keys
		// repeat instead — essential for Vim-style navigation (h/j/k/l).
		[[NSUserDefaults standardUserDefaults] setBool:NO forKey:@"ApplePressAndHoldEnabled"];

		[NSApplication sharedApplication];
		[NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];

		MermaidAppDelegate *delegate = [[MermaidAppDelegate alloc] init];
		delegate.serverURL = [NSString stringWithUTF8String:url];
		[NSApp setDelegate:delegate];

		// App menu
		NSMenu *menuBar = [[NSMenu alloc] init];
		NSMenuItem *appMenuItem = [[NSMenuItem alloc] init];
		[menuBar addItem:appMenuItem];

		NSMenu *appMenu = [[NSMenu alloc] initWithTitle:@"Mermaid Editor"];
		[appMenu addItemWithTitle:@"Quit Mermaid Editor"
		                   action:@selector(terminate:)
		            keyEquivalent:@"q"];
		[appMenuItem setSubmenu:appMenu];

		// Edit menu — required for Cmd+C/V/X/A/Z to work in WKWebView
		NSMenuItem *editMenuItem = [[NSMenuItem alloc] init];
		[menuBar addItem:editMenuItem];

		NSMenu *editMenu = [[NSMenu alloc] initWithTitle:@"Edit"];
		[editMenu addItemWithTitle:@"Undo" action:@selector(undo:) keyEquivalent:@"z"];
		[editMenu addItemWithTitle:@"Redo" action:@selector(redo:) keyEquivalent:@"Z"];
		[editMenu addItem:[NSMenuItem separatorItem]];
		[editMenu addItemWithTitle:@"Cut" action:@selector(cut:) keyEquivalent:@"x"];
		[editMenu addItemWithTitle:@"Copy" action:@selector(copy:) keyEquivalent:@"c"];
		[editMenu addItemWithTitle:@"Paste" action:@selector(paste:) keyEquivalent:@"v"];
		[editMenu addItemWithTitle:@"Select All" action:@selector(selectAll:) keyEquivalent:@"a"];
		[editMenuItem setSubmenu:editMenu];

		[NSApp setMainMenu:menuBar];

		[NSApp run];
	}
}
