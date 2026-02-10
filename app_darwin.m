#import <Cocoa/Cocoa.h>

extern void goShutdown(void);
extern void goOpenBrowser(void);

@interface MermaidAppDelegate : NSObject <NSApplicationDelegate>
@end

@implementation MermaidAppDelegate
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
@end

void runApp(void) {
	@autoreleasepool {
		[NSApplication sharedApplication];
		[NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];

		MermaidAppDelegate *delegate = [[MermaidAppDelegate alloc] init];
		[NSApp setDelegate:delegate];

		NSMenu *menuBar = [[NSMenu alloc] init];
		NSMenuItem *appMenuItem = [[NSMenuItem alloc] init];
		[menuBar addItem:appMenuItem];

		NSMenu *appMenu = [[NSMenu alloc] initWithTitle:@"Mermaid Editor"];
		[appMenu addItemWithTitle:@"Quit Mermaid Editor"
		                   action:@selector(terminate:)
		            keyEquivalent:@"q"];
		[appMenuItem setSubmenu:appMenu];
		[NSApp setMainMenu:menuBar];

		[NSApp run];
	}
}
