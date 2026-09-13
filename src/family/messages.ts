import type { AppLocale } from "../i18n";

const messages = {
  title: ["家庭邀请试点", "Family invitation pilot"],
  back: ["返回", "Back"],
  pilotNotice: [
    "这是独立的测试空间。请只填写虚构的宝宝资料和瓶喂记录；现有宝宝记录不会上传或共享。",
    "This is a separate test space. Use a fictional baby and bottle feeds only. Your existing baby records are never uploaded or shared.",
  ],
  account: ["试点账户", "Pilot account"],
  signIn: ["登录试点账户", "Sign in to the pilot"],
  signInDescription: [
    "使用已获准参与试点的邮箱登录，创建家庭或接受邀请。",
    "Sign in with an admitted pilot account to create a family or accept an invitation.",
  ],
  unconfigured: ["试点尚未配置", "Pilot setup is incomplete"],
  unconfiguredDescription: [
    "此版本尚未连接家庭试点服务。配置完成后，受邀账户可在手机上登录；原有离线记录可继续使用。",
    "This build is not connected to the family pilot service yet. Once configured, invited accounts can sign in on a phone. Your offline records remain available.",
  ],
  nativeOnly: ["请在手机版中登录", "Sign in on your phone"],
  nativeOnlyDescription: [
    "网页版可查看试点说明。此试点的账户登录只在手机应用中提供。",
    "You can read about the pilot here. Account sign-in is available in the mobile app.",
  ],
  signOut: ["退出登录", "Sign out"],
  retrySignOut: ["重试退出并清理", "Retry sign out and cleanup"],
  signOutTitle: ["退出试点账户？", "Sign out of the pilot?"],
  signOutDescription: [
    "将清除此设备上的试点缓存和登录信息。原有离线记录不受影响。",
    "Pilot data cached on this device and sign-in details will be cleared. Your existing offline records are unaffected.",
  ],
  signOutWithWork: [
    "此设备仍有未发送的修改或私人草稿。退出将永久丢弃这些试点内容，并清除试点缓存和登录信息。原有离线记录不受影响。",
    "This device has unsent changes or private drafts. Signing out permanently discards that pilot work and clears the pilot cache and sign-in details. Your existing offline records are unaffected.",
  ],
  refresh: ["刷新", "Refresh"],
  refreshing: ["正在刷新…", "Refreshing…"],
  lastUpdated: ["上次更新 {time}", "Updated {time}"],
  localCache: [
    "显示此设备上次保存的试点内容。",
    "Showing the pilot data last saved on this device.",
  ],
  createSection: ["创建测试家庭", "Create a test family"],
  babyName: ["虚构宝宝昵称", "Fictional baby name"],
  babyNamePlaceholder: ["例如：测试宝宝", "For example: Test baby"],
  createConsent: [
    "我了解这里只使用虚构数据；创建后，此昵称和主动保存的测试记录会发送到试点服务，并与家庭成员共享。",
    "I understand this space is for fictional data. Creating a family sends this name to the pilot service; test feeds I explicitly save will also be shared with family members.",
  ],
  createFamily: ["创建测试家庭", "Create test family"],
  oneFamily: [
    "试点中，每个账户只能加入一个家庭。",
    "Each account can belong to one family in this pilot.",
  ],
  joinSection: ["接受家庭邀请", "Accept a family invitation"],
  inviteLink: ["邀请链接", "Invitation link"],
  inviteLinkPlaceholder: [
    "粘贴收到的完整邀请链接",
    "Paste the complete invitation link",
  ],
  joinDescription: [
    "使用收到邀请的同一邮箱登录。只有点击“接受邀请”才会加入家庭。",
    "Sign in with the invited email address. You join only when you choose Accept invitation.",
  ],
  joinConsent: [
    "我了解这是虚构数据试点，接受邀请后可查看和编辑该家庭的测试瓶喂记录。",
    "I understand this pilot uses fictional data. Accepting lets me view and edit this family’s test bottle feeds.",
  ],
  acceptInvite: ["接受邀请", "Accept invitation"],
  family: ["测试家庭", "Test family"],
  owner: ["创建者", "Owner"],
  caregiver: ["照护者", "Caregiver"],
  you: ["你", "You"],
  members: ["家庭成员", "Family members"],
  membersCount: ["家庭成员（{count}）", "Family members ({count})"],
  sharingDescription: [
    "成员可查看、添加、修改和删除这个独立空间中的测试瓶喂记录。",
    "Members can view, add, edit and delete test bottle feeds in this separate space.",
  ],
  inviteSection: ["邀请照护者", "Invite a caregiver"],
  recipientEmail: ["受邀邮箱", "Recipient email"],
  recipientHint: [
    "仅限已获准参与试点的邮箱。新邀请会替换该邮箱尚未使用的邀请。",
    "Use an admitted pilot email address. A new invitation replaces any unused invitation for that email.",
  ],
  createInvitation: ["创建邀请链接", "Create invitation link"],
  shareInvite: ["分享邀请链接", "Share invitation link"],
  invitationReady: ["邀请链接已创建", "Invitation link created"],
  invitationMemory: [
    "链接仅在此页面暂存。请分享给指定收件人；离开页面后如需重发，请创建新邀请。",
    "The link is held on this page only. Share it with the named recipient. To send it again after leaving, create a new invitation.",
  ],
  clearInvite: ["清除链接", "Clear link"],
  invitations: ["邀请记录", "Invitations"],
  noInvitations: ["还没有发出邀请。", "No invitations sent yet."],
  pendingInvitation: ["待接受", "Waiting for acceptance"],
  acceptedInvitation: ["已接受", "Accepted"],
  revokedInvitation: ["已撤销", "Revoked"],
  expiredInvitation: ["已过期", "Expired"],
  expiresAt: ["到期：{time}", "Expires {time}"],
  revoke: ["撤销", "Revoke"],
  revokeTitle: ["撤销这条邀请？", "Revoke this invitation?"],
  revokeDescription: [
    "发给 {email} 的这个链接将不能再用于加入家庭。",
    "This invitation link for {email} will no longer allow them to join.",
  ],
  remove: ["移除", "Remove"],
  removeTitle: ["移除这位成员？", "Remove this member?"],
  removeDescription: [
    "{name} 将失去这个测试家庭的访问权限，发给此人的未使用邀请也会失效。已共享的记录会保留。",
    "{name} will lose access to this test family and their unused invitations will be revoked. Shared records will remain.",
  ],
  leave: ["离开测试家庭", "Leave test family"],
  leaveTitle: ["离开这个测试家庭？", "Leave this test family?"],
  leaveDescription: [
    "你将无法再查看此家庭的测试记录。此设备上的未发送修改会被保留为私人待检查内容，重新加入时不会自动发送。已共享的记录会保留。",
    "You will lose access to this family’s test feeds. Unsent work on this device will be kept privately for review and will not send automatically if you rejoin. Shared records will remain.",
  ],
  feedSection: ["测试瓶喂记录", "Test bottle feeds"],
  feedDescription: [
    "只记录已结束的瓶喂。草稿留在此设备；点击保存后才会与家庭共享。",
    "Record completed bottle feeds only. Drafts stay on this device; choose Save to share them with the family.",
  ],
  noFeeds: [
    "还没有测试记录。添加一条虚构的、已结束的瓶喂来试用共享。",
    "No test feeds yet. Add a fictional, completed bottle feed to try sharing.",
  ],
  addFeed: ["添加测试瓶喂", "Add test bottle feed"],
  editFeed: ["编辑", "Edit"],
  deleteFeed: ["删除", "Delete"],
  deleteFeedTitle: ["删除这条测试瓶喂？", "Delete this test bottle feed?"],
  deleteFeedDescription: [
    "保存删除后，此记录将从家庭测试列表中移除。离线时会在下次成功连接后发送。",
    "Saving this deletion removes the feed from the family test list. If offline, it will send after a successful connection.",
  ],
  privateDraft: ["此设备上的私人草稿", "Private draft on this device"],
  editingFeed: ["编辑测试瓶喂", "Edit test bottle feed"],
  draftDescription: [
    "输入会自动留在此设备上，不会自动共享。关闭页面后可继续。",
    "Your typing is kept on this device and is not shared automatically. You can return to it after closing this page.",
  ],
  startDate: ["开始日期", "Start date"],
  startTime: ["开始时间", "Start time"],
  endDate: ["结束日期", "End date"],
  endTime: ["结束时间", "End time"],
  localTimeHint: [
    "使用手机当地时间：YYYY-MM-DD 和 HH:mm。",
    "Use your phone’s local time: YYYY-MM-DD and HH:mm.",
  ],
  amount: ["实际喝下的奶量（mL）", "Amount actually drunk (mL)"],
  amountHint: ["输入 0–2000 的整数。", "Enter a whole number from 0 to 2000."],
  note: ["测试备注（选填）", "Test note (optional)"],
  notePlaceholder: ["只写虚构内容", "Fictional details only"],
  saveFeed: ["保存并共享", "Save and share"],
  saving: ["正在保存…", "Saving…"],
  discardDraft: ["丢弃草稿", "Discard draft"],
  discardDraftTitle: ["丢弃这个私人草稿？", "Discard this private draft?"],
  discardDraftDescription: [
    "这个草稿将从此设备删除。已共享的瓶喂记录不受影响。",
    "This draft will be deleted from this device. Shared bottle feeds are unaffected.",
  ],
  cancel: ["取消", "Cancel"],
  confirm: ["确认", "Confirm"],
  pendingCount: ["{count} 条修改待发送", "{count} changes waiting to send"],
  pendingDescription: [
    "这些修改已保存在此设备上。打开此页面且连接恢复后会重试；尚未确认的修改不会重复发送成新记录。",
    "These changes are saved on this device and will retry when this page is open and a connection is available. Retrying will not create duplicate records.",
  ],
  pendingFeed: ["待发送", "Waiting to send"],
  savedRefreshing: ["已保存，等待刷新", "Saved; waiting for refresh"],
  pendingDelete: ["删除待发送", "Deletion waiting to send"],
  firstCommit: [
    "同时修改同一条记录时，服务端先保存的版本会保留。另一份修改会作为私人草稿留待检查。",
    "If members change the same feed, the first version saved by the service stays. The other change is kept privately for review.",
  ],
  preservedSection: [
    "需要检查的私人修改（{count}）",
    "Private changes to review ({count})",
  ],
  preservedDescription: [
    "这些修改没有共享。请对照最新记录检查，之后再明确保存；旧修改不会自动重发。",
    "These changes have not been shared. Compare them with the latest feed before explicitly saving again. Old changes will not resend automatically.",
  ],
  reviewDraft: ["检查保留的修改", "Review preserved change"],
  preservedDelete: ["原操作：删除记录", "Original action: delete feed"],
  discardPreserved: ["丢弃此修改", "Discard this change"],
  discardPreservedTitle: [
    "丢弃这份保留的修改？",
    "Discard this preserved change?",
  ],
  discardPreservedDescription: [
    "仅删除此设备上的这份私人修改，不会更改家庭已共享的记录。",
    "Only this private change on this device will be deleted. Shared family records will not change.",
  ],
  recordedBy: ["记录者：{name}", "Recorded by {name}"],
  editedBy: ["修改者：{name}", "Edited by {name}"],
  memberFallback: ["家庭成员", "Family member"],
  details: ["详情", "Details"],
  showSection: ["展开{section}", "Show {section}"],
  hideSection: ["收起{section}", "Hide {section}"],
  working: ["正在处理…", "Working…"],
  errorGeneric: [
    "暂时无法完成操作。私人草稿和待发送修改会保留，请稍后重试。",
    "The action could not be completed. Private drafts and unsent changes are kept; try again later.",
  ],
  errorNetwork: [
    "暂时无法连接试点服务。已保存的修改留在此设备，连接恢复后会重试。",
    "The pilot service cannot be reached. Saved changes stay on this device and will retry when a connection is available.",
  ],
  errorUnauthorized: [
    "登录已过期。请重新登录同一账户；待发送修改会保留。",
    "Your sign-in has expired. Sign in again with the same account; unsent changes are kept.",
  ],
  errorNotAdmitted: [
    "此账户尚未获准参与试点，请联系试点负责人启用此账户。",
    "This account has not been admitted to the pilot. Ask the pilot owner to enable this account.",
  ],
  errorForbidden: [
    "此账户没有执行此操作的权限。请刷新以检查家庭成员状态。",
    "This account cannot perform this action. Refresh to check your family membership.",
  ],
  errorRevoked: [
    "你已无法访问此测试家庭。未发送的修改已保留为私人待检查内容，不会自动共享。",
    "You no longer have access to this test family. Unsent work is kept privately for review and will not share automatically.",
  ],
  errorAlreadyFamily: [
    "此账户已加入一个测试家庭。试点中每个账户只能加入一个家庭。",
    "This account already belongs to a test family. Only one family per account is supported in the pilot.",
  ],
  errorInvitationUnavailable: [
    "此邀请无法使用。请确认登录的是受邀邮箱，并请创建者发送新邀请。",
    "This invitation is unavailable. Check that you signed in with the invited email and ask the owner for a new invitation.",
  ],
  errorInvitationCreated: [
    "邀请已创建，但这个链接无法再次取回。请创建新邀请后再分享。",
    "The invitation was created, but its link cannot be retrieved again. Create a new invitation to share.",
  ],
  errorRecordChanged: [
    "此记录已被其他成员修改。最新版本已保留，你的修改留在私人待检查内容中。",
    "Another member changed this feed. The latest version stays and your change is kept privately for review.",
  ],
  errorMembershipChanged: [
    "家庭访问权限已改变。旧修改已保留为私人待检查内容，重新加入后也不会自动发送。",
    "Family access has changed. Old changes are kept privately for review and will not send automatically after rejoining.",
  ],
  errorHistoryChanged: [
    "试点服务的数据版本已更换。旧修改已保留为私人待检查内容，请刷新后检查。",
    "The pilot service’s data history has changed. Old changes are kept privately for review. Refresh before reviewing them.",
  ],
  errorInvalidInput: [
    "请检查昵称、邮箱和记录内容后重试。瓶喂需要有效的开始与结束时间，奶量为 0–2000 mL 的整数。",
    "Check the name, email and feed details. Feeds need valid start and end times and a whole-number amount from 0 to 2000 mL.",
  ],
  errorRateLimited: [
    "操作次数较多，请稍等后重试。已保存的修改仍在此设备上。",
    "Too many requests. Wait a moment and retry. Saved changes remain on this device.",
  ],
  errorBusyRecord: [
    "这条记录已有待发送修改。请等待发送完成后再编辑或删除。",
    "This feed already has a change waiting to send. Wait for it to finish before editing or deleting.",
  ],
  errorDate: [
    "请输入有效的日期和时间，格式为 YYYY-MM-DD 和 HH:mm。",
    "Enter a valid date and time in YYYY-MM-DD and HH:mm format.",
  ],
  errorEnd: [
    "结束时间不能早于开始时间。",
    "The end time cannot be before the start time.",
  ],
  errorFuture: [
    "只可记录已经结束的瓶喂，请检查开始和结束时间。",
    "Only completed feeds can be recorded. Check the start and end times.",
  ],
  errorAmount: [
    "奶量必须是 0–2000 mL 的整数。",
    "The amount must be a whole number from 0 to 2000 mL.",
  ],
  errorShare: [
    "邀请已创建，但未能打开分享菜单。可重试分享或创建新邀请。",
    "The invitation was created, but sharing could not open. Try sharing again or create a new invitation.",
  ],
  errorDraftExists: [
    "请先保存或丢弃当前私人草稿。",
    "Save or discard the current private draft first.",
  ],
  errorSignInCancelled: [
    "登录已取消。可再次登录后继续。",
    "Sign-in was cancelled. Sign in again when you are ready.",
  ],
  errorSignInFailed: [
    "暂时无法完成登录。请重试，并确认使用已获准参与试点的账户。",
    "Sign-in could not be completed. Try again with an admitted pilot account.",
  ],
  errorSessionChanged: [
    "当前账户已改变。请重新打开试点页面，确认账户后继续。",
    "The active account has changed. Reopen the pilot page and check the account before continuing.",
  ],
  errorAccountMismatch: [
    "登录的账户与原账户不同。原账户的私人草稿和待发送修改仍单独保留；请使用原账户重新登录后继续。",
    "You signed in with a different account. The original account’s private drafts and unsent changes are kept separately. Sign in with the original account to continue.",
  ],
  errorLocalSave: [
    "无法把这次修改保存到此设备。请保持此页面打开，检查设备存储空间后重试；不要依赖尚未保存的输入。",
    "This change could not be saved on this device. Keep this page open, check available storage and retry. The latest typing may not be saved.",
  ],
  errorLocalData: [
    "无法读取此设备上的试点数据。请保留应用和现有数据，并联系试点负责人检查。",
    "Pilot data on this device could not be read. Keep the app and its data, and ask the pilot owner to investigate.",
  ],
  errorActionBusy: [
    "另一项操作正在进行，请稍等。",
    "Another action is in progress. Wait a moment.",
  ],
  errorSignOutFirst: [
    "更换账户前请先退出。退出会清除此设备上的试点私人草稿和待发送修改。",
    "Sign out before changing accounts. Signing out clears private pilot drafts and unsent changes on this device.",
  ],
  errorSignOutFailed: [
    "已停止此页面的家庭连接，但未能完成此设备上的退出清理。请保持页面打开并重试退出，完成清理后再登录。原有离线记录不受影响。",
    "Family activity on this page has stopped, but cleanup on this device did not finish. Keep this page open and retry sign out before signing in again. Your existing offline records are unaffected.",
  ],
  errorFamilyUnavailable: [
    "当前没有可访问的测试家庭。请刷新，或接受一条有效邀请。",
    "No test family is currently available. Refresh or accept a valid invitation.",
  ],
  errorDraftChanged: [
    "草稿状态已改变。请检查当前显示的内容后继续。",
    "The draft has changed. Check the content currently shown before continuing.",
  ],
  errorQueueFull: [
    "此设备上待处理的试点修改已达上限。请连接服务发送修改，或检查并丢弃不再需要的保留内容。",
    "This device has reached the limit for unresolved pilot changes. Connect to send saved changes, or review and discard preserved changes you no longer need.",
  ],
  noticeSavedLocally: [
    "修改已保存在此设备上；连接成功后会发送到家庭。",
    "The change is saved on this device and will send to the family after a successful connection.",
  ],
  noticeSignedOut: [
    "已退出试点账户，此设备上的试点内容已清除。",
    "Signed out of the pilot. Pilot data on this device has been cleared.",
  ],
  noticeContextChanged: [
    "家庭访问权限或数据历史已改变。保留的私人修改需要重新检查，不会自动发送。",
    "Family access or data history has changed. Preserved private changes need a fresh review and will not send automatically.",
  ],
  noticeNotShared: [
    "有修改未能共享，已保留在“需要检查的私人修改”中。",
    "A change could not be shared. It is kept under Private changes to review.",
  ],
  noticeReviewLatest: [
    "已打开保留的内容。请对照下方最新记录检查，再决定是否保存并共享。",
    "The preserved content is open. Compare it with the latest feed below before choosing Save and share.",
  ],
  noticeReviewAsNew: [
    "原记录已不存在。请检查保留的内容；再次保存会创建一条新测试记录。",
    "The original feed no longer exists. Review the preserved content; saving again will create a new test feed.",
  ],
  reviewPrivateDraft: ["重新检查此草稿", "Review this draft again"],
  reviewPrivateTitle: [
    "为当前家庭重新检查草稿？",
    "Review this draft for the current family?",
  ],
  reviewPrivateDescription: [
    "此草稿来自之前的访问权限或数据历史。继续会用当前家庭的最新记录作为比较基础；原记录不存在时会准备一条新记录。检查后仍需点击“保存并共享”才会发送。",
    "This draft belongs to earlier access or data history. Continue to compare it against the current family’s latest feed. If that feed no longer exists, it will become a new draft. It sends only after you choose Save and share.",
  ],
} as const;

export type FamilyMessageKey = keyof typeof messages;

export function familyMessage(
  locale: AppLocale,
  key: FamilyMessageKey,
  values: Record<string, string | number> = {},
): string {
  return messages[key][locale === "zh-CN" ? 0 : 1].replace(
    /\{(\w+)\}/g,
    (_, name: string) => String(values[name] ?? ""),
  );
}

const errorMessages: Record<string, FamilyMessageKey> = {
  unauthorized: "errorUnauthorized",
  pilot_not_admitted: "errorNotAdmitted",
  forbidden: "errorForbidden",
  membership_revoked: "errorRevoked",
  already_in_family: "errorAlreadyFamily",
  invitation_unavailable: "errorInvitationUnavailable",
  invitation_already_created: "errorInvitationCreated",
  record_changed: "errorRecordChanged",
  membership_changed: "errorMembershipChanged",
  history_changed: "errorHistoryChanged",
  invalid_input: "errorInvalidInput",
  rate_limited: "errorRateLimited",
  network_error: "errorNetwork",
  offline: "errorNetwork",
  record_pending: "errorBusyRecord",
  draft_exists: "errorDraftExists",
  native_required: "nativeOnlyDescription",
  not_configured: "unconfiguredDescription",
  session_changed: "errorSessionChanged",
  account_mismatch: "errorAccountMismatch",
  sign_in_required: "errorUnauthorized",
  sign_in_cancelled: "errorSignInCancelled",
  sign_in_failed: "errorSignInFailed",
  network_unavailable: "errorNetwork",
  service_unavailable: "errorNetwork",
  request_failed: "errorGeneric",
  invalid_response: "errorGeneric",
  invalid_invitation: "errorInvitationUnavailable",
  invalid_feed: "errorInvalidInput",
  local_save_failed: "errorLocalSave",
  local_data_invalid: "errorLocalData",
  action_busy: "errorActionBusy",
  sign_out_first: "errorSignOutFirst",
  sign_out_failed: "errorSignOutFailed",
  family_unavailable: "errorFamilyUnavailable",
  draft_changed: "errorDraftChanged",
  queue_full: "errorQueueFull",
};

export function familyErrorMessage(locale: AppLocale, code: string): string {
  return familyMessage(locale, errorMessages[code] ?? "errorGeneric");
}

const noticeMessages: Record<string, FamilyMessageKey> = {
  sharing_context_changed: "noticeContextChanged",
  membership_revoked: "errorRevoked",
  change_not_shared: "noticeNotShared",
  saved_locally: "noticeSavedLocally",
  signed_out: "noticeSignedOut",
  review_latest: "noticeReviewLatest",
  review_as_new: "noticeReviewAsNew",
};

export function familyNoticeMessage(
  locale: AppLocale,
  code: string,
): string | null {
  const key = noticeMessages[code];
  return key ? familyMessage(locale, key) : null;
}
