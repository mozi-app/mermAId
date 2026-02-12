#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

extern void goShutdown(void);
extern void goOpenBrowser(void);

@interface MermaidAppDelegate : NSObject <NSApplicationDelegate, WKNavigationDelegate, WKDownloadDelegate>
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
	if (![self.window setFrameAutosaveName:@"MermaidEditorMain"]) {
		[self.window center];
	}

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

// Detect Content-Disposition: attachment responses and trigger a download
- (void)webView:(WKWebView *)webView
	decidePolicyForNavigationResponse:(WKNavigationResponse *)navigationResponse
	                  decisionHandler:(void (^)(WKNavigationResponsePolicy))decisionHandler {
	if ([navigationResponse.response isKindOfClass:[NSHTTPURLResponse class]]) {
		NSHTTPURLResponse *httpResponse = (NSHTTPURLResponse *)navigationResponse.response;
		NSString *disposition = httpResponse.allHeaderFields[@"Content-Disposition"];
		if (disposition && [disposition containsString:@"attachment"]) {
			decisionHandler(WKNavigationResponsePolicyDownload);
			return;
		}
	}
	decisionHandler(WKNavigationResponsePolicyAllow);
}

- (void)webView:(WKWebView *)webView
	navigationResponse:(WKNavigationResponse *)navigationResponse
	didBecomeDownload:(WKDownload *)download {
	download.delegate = self;
}

- (void)webView:(WKWebView *)webView
	navigationAction:(WKNavigationAction *)navigationAction
	didBecomeDownload:(WKDownload *)download {
	download.delegate = self;
}

// WKDownloadDelegate — present a native save dialog
- (void)download:(WKDownload *)download
	decideDestinationUsingResponse:(NSURLResponse *)response
	suggestedFilename:(NSString *)suggestedFilename
	completionHandler:(void (^)(NSURL * _Nullable))completionHandler {
	NSSavePanel *panel = [NSSavePanel savePanel];
	panel.nameFieldStringValue = suggestedFilename;
	[panel beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse result) {
		if (result == NSModalResponseOK) {
			// Remove any existing file so WKDownload can write to the path
			[[NSFileManager defaultManager] removeItemAtURL:panel.URL error:nil];
			completionHandler(panel.URL);
		} else {
			completionHandler(nil);
		}
	}];
}

- (void)download:(WKDownload *)download didFailWithError:(NSError *)error
	resumeData:(NSData * _Nullable)resumeData {
	NSLog(@"Download failed: %@", error.localizedDescription);
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
		[appMenu addItemWithTitle:@"Hide Mermaid Editor"
		                   action:@selector(hide:)
		            keyEquivalent:@"h"];
		NSMenuItem *hideOthersItem = [appMenu addItemWithTitle:@"Hide Others"
		                   action:@selector(hideOtherApplications:)
		            keyEquivalent:@"h"];
		[hideOthersItem setKeyEquivalentModifierMask:(NSEventModifierFlagCommand | NSEventModifierFlagOption)];
		[appMenu addItemWithTitle:@"Show All"
		                   action:@selector(unhideAllApplications:)
		            keyEquivalent:@""];
		[appMenu addItem:[NSMenuItem separatorItem]];
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
