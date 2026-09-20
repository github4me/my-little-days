import type { AppLocale } from "../i18n";

const messages = {
  errorWatchPending: [
    "仍有手表记录等待写入手机。请保持小日子打开，待手表同步完成后再创建或加入家庭。",
    "Watch records are waiting to be saved on this phone. Keep Little Days open and finish Watch sync before creating or joining a family.",
  ],
  errorReminderCleanup: [
    "部分家庭提醒尚未清理完成，新的提醒已暂停。请重试；如旧提醒仍出现，可暂时在手机设置中关闭本应用通知。不要清空本机资料。",
    "Some family reminders could not be cleared; new reminders are paused. Retry. If old reminders still appear, temporarily turn off this app’s notifications in phone settings. Do not clear local data.",
  ],
  errorFamilyQuota: [
    "家庭资料已达到安全容量上限，未共享的修改仍保留在本机待处理。请联系支持人员协助处理；不要反复提交或清空本机资料。",
    "This family has reached a safety limit. Unshared changes remain on this device for review. Contact support for help; do not repeatedly submit or clear local data.",
  ],
  errorFamilyCreationLimit: [
    "短时间内创建并解散家庭次数过多，请稍后再试。现有资料不会因此清理。",
    "Too many families were created and closed recently. Try again later; this does not clear your existing data.",
  ],
  errorRecoveryBlocked: [
    "服务正在进行安全恢复核验，暂时无法访问或更改家庭资料。请稍后重试，不要清空本机资料。",
    "The service is undergoing a safety recovery check. Family access and changes are temporarily unavailable. Try again later; do not clear local data.",
  ],
  title: ["家庭邀请试点", "Family invitation pilot"],
  back: ["返回", "Back"],
  demoNotice: [
    "仅供界面预览 · 所有账户和记录均为样例。不登录、不联网、不保存；退出或切换场景会重置，真实资料不受影响。",
    "UI preview only · All accounts and records are samples. No sign-in, network requests or storage. Leaving or changing scenarios resets the demo; real data is untouched.",
  ],
  demoConfirmation: [
    "模拟操作：只改变当前样例画面，不会操作真实账户或记录。",
    "Simulated action: changes only this sample screen, never real accounts or records.",
  ],
  pilotNotice: [
    "这是独立的测试空间。请只填写虚构的宝宝资料和瓶喂记录；现有宝宝记录不会上传或共享。",
    "This is a separate test space. Use a fictional baby and bottle feeds only. Your existing baby records are never uploaded or shared.",
  ],
  account: ["我的账户", "My account"],
  accountSignedOut: ["未登录", "Signed out"],
  accountChecking: ["正在验证登录状态…", "Checking sign-in…"],
  accountTokenRecognized: ["已识别登录信息", "Sign-in recognized"],
  familyServiceConnecting: [
    "正在连接家庭服务…",
    "Connecting to family service…",
  ],
  familyServiceUnavailable: [
    "家庭服务暂时不可用，请稍后刷新重试。",
    "Family service is temporarily unavailable. Refresh to try again.",
  ],
  accountAccessPendingDetails: [
    "账户与家庭访问权限仍待核验。核验完成前，家庭功能暂不可用。",
    "Account and family access checks are still pending. Family actions remain unavailable until those checks succeed.",
  ],
  accountSavedSignInDetails: [
    "此设备保存了登录信息。请联网核验账户与家庭访问权限；核验完成前，家庭功能暂不可用。",
    "A sign-in is saved on this device. Connect to verify your account and family access. Family actions remain unavailable until those checks succeed.",
  ],
  accountRecognizedCachedDetails: [
    "以上为此设备保存的账户资料，不代表当前账户或家庭访问权限已获确认。",
    "These account details are saved on this device. They do not confirm current account or family access.",
  ],
  accountConnecting: ["正在连接…", "Connecting…"],
  accountConnectionUnavailable: ["暂时无法连接", "Connection unavailable"],
  accountConnectingDetails: [
    "正在连接服务并确认登录状态，暂显示本机保存的账户资料。",
    "Connecting to confirm your sign-in. Showing account details saved on this device for now.",
  ],
  accountConnectionDetails: [
    "暂时无法确认登录状态，显示本机保存的账户资料。连接恢复后会自动重试。",
    "Your sign-in could not be checked. Showing account details saved on this device; we’ll retry when connected.",
  ],
  accountSignedIn: ["已登录", "Signed in"],
  accountExpired: ["登录已过期", "Session expired"],
  accountUnverified: ["登录状态待验证", "Not verified"],
  accountCachedDetails: [
    "以下为此设备缓存的账户资料，不代表当前登录仍然有效。",
    "These are cached account details from this device, not confirmation of a valid current session.",
  ],
  accountExpiredAction: [
    "登录已过期，请重新登录后再进行账户或家庭管理操作。",
    "Session expired. Sign in again before managing your account or family.",
  ],
  accountVerifyAction: [
    "请先联网验证登录状态，再继续此操作。",
    "Connect and verify your sign-in before continuing this action.",
  ],
  signInAgain: ["重新登录", "Sign in again"],
  noticeSignInCancelled: [
    "已取消本次登录。",
    "This sign-in attempt was cancelled.",
  ],
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
  signOutDuringTransition: [
    "上次家庭操作的结果尚未确认，服务端可能已经完成。退出会丢弃此设备上的家庭缓存、草稿、待发送修改和重试意图；不会撤销服务端操作。下次登录将刷新最新状态。账户删除查询凭证会保留，以便继续检查删除进度。原有离线宝宝记录不受影响。",
    "The last family action is unconfirmed and may already have completed on the server. Signing out discards this device’s family cache, drafts, unsent changes and retry intent; it does not undo a server action. Your next sign-in refreshes the latest status. An account-deletion receipt is kept so you can still check its progress. Original offline baby records are unaffected.",
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
  ownerSetup: ["创建家庭群组", "Create a family group"],
  createBlockedMember: [
    "你已加入一个家庭群组，暂时不能创建其他群组。请先退出当前家庭，再创建自己的群组。退出后将无法再查看该家庭的记录，你的共享记录仍留在原家庭。",
    "You already belong to a family group, so you cannot create another. First leave your current family, then create your own group. You will lose access to its records; your shared contributions stay with that family.",
  ],
  createBlockedOwner: [
    "你已加入一个家庭群组并担任管理员，不能再创建其他群组。请先转让管理员（需对方接受）并退出，或解散当前群组。退出后将无法再查看该家庭的记录；解散将删除整个家庭群组的数据。",
    "You already belong to a family group as its admin and cannot create another. First transfer administration (the other member must accept) and leave, or close your group. Leaving means you lose access to its records; closing deletes the whole family’s data.",
  ],
  ownerDeclineWarning: [
    "创建自己的家庭群组后，系统将自动拒绝你收到的所有待处理邀请，包括创建完成前新收到的邀请。创建失败则保留邀请。以后如需加入其他家庭，请先退出或解散自己的群组，并获取新的邀请。",
    "Creating your own family group will automatically decline all pending invitations you have received, including any arriving before creation completes. If creation fails, they stay pending. To join another family later, leave or close your group and receive a new invitation.",
  ],
  ownerPendingCount: [
    "你有 {count} 条待处理的家庭邀请。",
    "You have {count} pending family invitation(s).",
  ],
  ownerDeclineConsent: [
    "我同意创建成功时自动拒绝收到的待处理邀请。",
    "I agree to decline received pending invitations when creation succeeds.",
  ],
  ownerCreateAndDecline: [
    "创建家庭并拒绝收到的邀请",
    "Create family and decline invitations",
  ],
  errorDeclineConsent: [
    "请更新应用并重新查看创建或加入确认，确认是否拒绝收到的其他待处理邀请。尚未创建或加入家庭，也未拒绝邀请。",
    "Update the app and review creating or joining the family again to confirm declining other received invitations. No family was created or joined, and no invitations were declined.",
  ],
  ownerSetupDescription: [
    "首次邀请将以你的宝宝资料和已保存记录建立一个家庭，由你担任管理员。后续邀请加入同一家庭，不会重复导入。",
    "Your first invitation starts one family from your baby profile and saved records, with you as admin. Later invitations join that same family without importing the records again.",
  ],
  ownerCreatorRecommendation: [
    "建议由宝宝资料最完整的成员创建家庭并担任首位管理员：创建者的资料会成为家庭初始资料，其他成员加入时不会合并原有资料。",
    "The member with the most complete baby history should create the family and be its first admin. Their data becomes the family’s starting history; other members’ existing data is not merged when they join.",
  ],
  ownerSetupLocalNotice: [
    "尚未连接完整家庭服务。本次只把设置草稿保存在此设备：不会创建线上家庭、发送邀请、上传或替换宝宝记录。Azure 全量记录接口接入后，仍需重新查看并确认发送。",
    "Full family service is not connected yet. This only saves a setup draft on this device: no online family is created, no invitation is sent, and no baby records are uploaded or replaced. After the Azure full-history service is connected, you must review and confirm sending again.",
  ],
  ownerSetupDemoNotice: [
    "下面仅使用虚构的样例资料。创建和邀请都是本次预览中的模拟操作。",
    "Only fictional sample data is used below. Creation and invitations are simulated for this preview session.",
  ],
  ownerSetupProfile: ["将作为家庭资料的宝宝", "Baby profile for the family"],
  ownerSetupCounts: ["现有已保存记录", "Existing saved records"],
  ownerSeededCounts: ["家庭初始记录", "Family starting records"],
  ownerSeededHint: [
    "完整样例已保留：喂养、尿布、睡眠、成长、里程碑及日常照护。下方瓶喂编辑器仅用于演示；全类型共享编辑待接口接入。",
    "The complete sample is retained: feeds, nappies, sleep, growth, milestones and daily care. The bottle-feed editor below is a demo; shared editing for every record type awaits service integration.",
  ],
  ownerCountFeed: ["喂养", "Feeds"],
  ownerCountDiaper: ["尿布", "Nappies"],
  ownerCountSleep: ["睡眠", "Sleep"],
  ownerCountGrowth: ["成长", "Growth"],
  ownerCountMilestone: ["里程碑", "Milestones"],
  ownerCountCare: ["日常照护", "Daily care"],
  ownerEmails: ["家人邮箱（最多 5 个）", "Family emails (up to 5)"],
  ownerTotalRecords: ["记录总数：{count}", "Total records: {count}"],
  ownerInviteeCount: ["受邀人数：{count}/{limit}", "Invitees: {count}/{limit}"],
  invitationSlots: [
    "邀请名额：{used}/{limit} · 还可邀请 {remaining} 人",
    "Invitation places: {used}/{limit} · {remaining} available",
  ],
  invitationCapacityHint: [
    "管理员之外最多 5 人；已加入成员和有效待接受邀请均占名额。取消、拒绝或过期后可重新邀请。",
    "Up to 5 people besides the admin. Current members and valid pending invitations both use a place. Cancelled, declined or expired invitations free their places.",
  ],
  ownerEmailsHint: [
    "每行一个，或用逗号分隔。对方无需已注册，也不会收到通知；以后登录并验证邮箱后可接受或拒绝。",
    "One per line, or separated by commas. They need not be registered. No notification is sent; after signing in and verifying their email, they can accept or decline.",
  ],
  ownerReview: ["查看并确认", "Review setup"],
  ownerReviewTitle: ["确认家庭初始资料", "Review the family’s starting data"],
  ownerReviewSharing: [
    "正式启用时，这些资料和记录将成为家庭共享数据，家庭成员可以查看。受邀成员的个人记录不会合并进来。管理员转让需对方接受；同一家庭的全部数据管理权随之转让，原始作者不变，不复制数据。",
    "When sharing is activated, this profile and these records become shared family data visible to members. Invitees’ personal records are never merged in. Admin transfer requires acceptance and transfers control of all data in this same family; original authors stay unchanged and no data is copied.",
  ],
  ownerExclusions: [
    "照片、设备偏好、提醒和早教打卡仍只在本机，不包含在此次设置中。正在计时的喂养或睡眠须先结束并保存。",
    "Photos, device preferences, reminders and play check-ins stay on this device and are not included. Finish and save any running feeding or sleep timer first.",
  ],
  ownerConsent: [
    "我已查看初始资料，了解未来启用共享后家庭成员可见，并且受邀人的记录不会合并。当前操作只模拟或本地保存，不会发送。",
    "I have reviewed the starting data and understand that family members can see it when sharing is activated. Invitees’ records are not merged. This action only simulates or saves locally; nothing is sent.",
  ],
  ownerCreateDemo: ["创建家庭并邀请", "Create family and invite"],
  ownerSaveLocal: ["仅保存到此设备", "Save setup on this device"],
  ownerDraftSaved: [
    "已保存本机设置 · 尚未发送",
    "Setup saved on this device · Not sent",
  ],
  ownerDraftHint: [
    "这不是已经建立的家庭。连接服务后需重新确认；你的原始宝宝资料与记录仍正常保留。",
    "This is not an active family. Review again after the service is connected. Your original baby profile and records remain available.",
  ],
  ownerReviewSaved: ["重新查看设置", "Review saved setup"],
  ownerDiscardSaved: ["删除设置草稿", "Delete setup draft"],
  ownerDiscardTitle: ["删除本机设置草稿？", "Delete this setup draft?"],
  ownerDiscardDescription: [
    "只删除家庭设置草稿。不会删除宝宝资料、原始记录、线上家庭或邀请。",
    "Only the family setup draft will be deleted. Your baby profile, original records, online families and invitations are not deleted.",
  ],
  ownerGenericError: [
    "设置未保存。请检查邮箱和记录后重试；原始宝宝资料不受影响。",
    "Setup was not saved. Check the emails and records, then retry. Your original baby data is unaffected.",
  ],
  ownerLegacyReminderError: [
    "旧版提醒缺少可迁移的准确时间或规则。请返回“我的 → 照护提醒”，删除并重新设置旧提醒，再查看创建资料；原记录没有清理。",
    "An older reminder has no reliable time or rule to migrate. In More → Care reminders, delete and recreate it, then review again. Your existing records have not been cleared.",
  ],
  ownerExtraReadError: [
    "照片或其他共享资料无法完整读取，请检查头像与本机资料后重新查看。不会跳过这些资料或清理原记录。",
    "The photo or other shared data could not be read completely. Check the photo and local data, then review again. Nothing will be skipped or cleared.",
  ],
  ownerTimerError: [
    "请先结束并保存正在计时的喂养或睡眠，再重新查看家庭设置。",
    "Finish and save the running feeding or sleep timer, then review the family setup again.",
  ],
  ownerChangedError: [
    "宝宝资料或记录已变更。请关闭确认窗口，重新查看最新资料后再保存。",
    "The baby profile or records changed. Close this confirmation and review the latest data before saving.",
  ],
  ownerEmailError: [
    "请填写 1–5 个有效且不同的家人邮箱。",
    "Enter 1–5 valid, different family email addresses.",
  ],
  joinSection: ["接受家庭邀请", "Accept a family invitation"],
  receivedInvitations: [
    "收到的家庭邀请（{count}）",
    "Received family invitations ({count})",
  ],
  inviteLink: ["邀请链接", "Invitation link"],
  inviteLinkPlaceholder: [
    "粘贴收到的完整邀请链接",
    "Paste the complete invitation link",
  ],
  joinDescription: [
    "使用受邀邮箱完成验证后，邀请会显示在这里。不会发送邀请通知；登录不会自动加入家庭。",
    "Invitations appear here after you verify the invited email. No invitation notifications are sent. Signing in never joins a family automatically.",
  ],
  joinConsent: [
    "我了解管理员的权限、被移除后的数据访问限制，以及这里只使用虚构数据；同意加入成功时自动拒绝收到的其他待处理邀请。",
    "I understand the admin’s permissions, loss of access after removal, and that this pilot is for fictional data only. I agree to decline my other pending invitations when joining succeeds.",
  ],
  joinDeclineWarning: [
    "加入成功时，系统将自动拒绝你收到的其他待处理邀请，包括加入完成前新收到的邀请。仅在服务端确认加入成功时才会处理；确认前取消不会改变任何邀请。其他邀请人会看到你因加入另一个家庭群组而自动拒绝，但不会获知该群组的身份。以后加入其他家庭需要新的邀请。",
    "Joining will automatically decline all other pending invitations you have received, including any arriving before joining completes. This happens only when the server accepts your join; cancelling before confirmation changes nothing. Other inviters can see that you joined another family group, but not which one. Joining those families later requires a new invitation.",
  ],
  acceptInvite: ["接受邀请", "Accept invitation"],
  acceptInviteTitle: ["加入这个测试家庭？", "Join this test family?"],
  joinWarning: [
    "管理员可随时移除你，无需提前通知；你将失去全部家庭记录的访问权，包括自己创建的记录。已共享的记录会留在家庭中，管理员也可编辑或删除任何记录。服务端访问立即停止；离线设备会在检测到移除后清除缓存、草稿和未发送修改。\n\n这是独立的虚构数据试点：不会上传、替换或删除你原有的离线宝宝记录，也不会把其他家庭的内容带入此家庭。",
    "The admin can remove you at any time without advance notice. You will lose access to all family records, including those you created. Shared records stay with the family, and the admin can edit or delete any record. Server access ends immediately; an offline device clears its cache, drafts and unsent changes when it detects removal.\n\nThis separate fictional-data pilot never uploads, replaces or deletes your existing offline baby records. Data from another family is never carried into this family.",
  ],
  noIncomingInvitations: [
    "没有待接受的邀请。请让管理员添加你已验证的邮箱，然后刷新。",
    "No pending invitations. Ask the admin to add your verified email, then refresh.",
  ],
  invitedBy: ["邀请人：{name}", "Invited by {name}"],
  declineInvite: ["拒绝", "Decline"],
  declineInviteTitle: ["拒绝这条邀请？", "Decline this invitation?"],
  declineInviteDescription: [
    "你不会加入此家庭，也不会改变现有数据。以后加入需要管理员重新邀请。",
    "You will not join this family and your existing data will not change. The admin must invite you again if you want to join later.",
  ],
  family: ["测试家庭", "Test family"],
  owner: ["管理员", "Admin"],
  caregiver: ["照护者", "Caregiver"],
  you: ["你", "You"],
  members: ["家庭成员", "Family members"],
  membersCount: ["家庭成员（{count}）", "Family members ({count})"],
  unlinkedMembershipHistory: [
    "未关联邀请的成员历史",
    "Unlinked membership history",
  ],
  memberHistoryDescription: [
    "仅管理员可见，不计入当前成员人数。可通过「邀请照护者」再次邀请；对方接受后才会重新加入，历史记录仍会保留。",
    "Only admins can see this history. These past memberships do not count towards the current member total. Use Invite a caregiver to invite them again; they must accept to rejoin, and the history is retained.",
  ],
  sharingDescription: [
    "成员可查看家庭记录，并修改或删除自己添加的记录。管理员可修改或删除任何记录。成员离开或被移除时，已共享的记录不会自动删除。",
    "Members can view family records and edit or delete their own. Admins can edit or delete any record. Leaving or removal does not automatically delete shared contributions.",
  ],
  inviteSection: ["邀请照护者", "Invite a caregiver"],
  recipientEmail: ["受邀邮箱", "Recipient email"],
  recipientHint: [
    "填写家人的邮箱，即使对方还未注册。不会发送邮件或通知；对方验证该邮箱并登录后可自行接受。邀请 30 天后过期。",
    "Enter a family member’s email, even before they register. No email or notification is sent; they can accept after verifying that email and signing in. Invitations expire after 30 days.",
  ],
  createInvitation: ["添加邀请", "Add invitation"],
  shareInvite: ["分享邀请链接", "Share invitation link"],
  invitationReady: [
    "邀请已保存，不会发送通知",
    "Invitation saved; no notification sent",
  ],
  invitationMemory: [
    "链接仅在此页面暂存。请分享给指定收件人；离开页面后如需重发，请创建新邀请。",
    "The link is held on this page only. Share it with the named recipient. To send it again after leaving, create a new invitation.",
  ],
  clearInvite: ["清除链接", "Clear link"],
  invitations: ["邀请记录", "Invitations"],
  noInvitations: ["还没有发出邀请。", "No invitations sent yet."],
  pendingInvitation: ["待接受", "Waiting for acceptance"],
  acceptedInvitation: ["已接受", "Accepted"],
  acceptedRemovedInvitation: ["已接受 · 后已移除", "Accepted · later removed"],
  acceptedLeftInvitation: ["已接受 · 后已退出", "Accepted · later left"],
  declinedInvitation: ["已拒绝", "Declined"],
  declinedCreatedFamily: [
    "已自动拒绝 · 对方创建了自己的家庭群组",
    "Automatically declined · recipient created their own family group",
  ],
  declinedJoinedFamily: [
    "已自动拒绝 · 对方加入了其他家庭群组",
    "Automatically declined · recipient joined another family group",
  ],
  revokedInvitation: ["已撤销", "Revoked"],
  expiredInvitation: ["已过期", "Expired"],
  expiresAt: ["到期：{time}", "Expires {time}"],
  revoke: ["撤销", "Revoke"],
  revokeTitle: ["撤销这条邀请？", "Revoke this invitation?"],
  revokeDescription: [
    "{email} 将不能再接受这条邀请。",
    "{email} will no longer be able to accept this invitation.",
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
    "你将失去全部家庭测试记录的访问权，包括自己添加的记录。此设备上的家庭缓存、草稿和未发送修改会被删除；已被服务端接受的记录留在家庭中。重新加入需要新邀请。原有离线宝宝记录不受影响。",
    "You will lose access to every family test record, including your own. Family cache, drafts and unsent changes on this device will be deleted. Records already accepted by the service stay with the family. Rejoining requires a new invitation. Your original offline baby records are unaffected.",
  ],
  activeMember: ["当前成员", "Active"],
  leftMember: ["已离开", "Left"],
  removedMember: ["已移除", "Removed"],
  endedAt: ["结束访问：{time}", "Access ended {time}"],
  profile: ["测试宝宝资料", "Test baby profile"],
  profileDescription: [
    "只有管理员可以修改家庭宝宝资料。仅使用虚构信息，不上传照片。",
    "Only the admin can change the family baby profile. Use fictional details only; photo uploads are not part of this pilot.",
  ],
  babyBirthDate: ["虚构出生日期（选填）", "Fictional birth date (optional)"],
  noBirthDate: ["未设置出生日期", "Birth date not set"],
  saveProfile: ["保存宝宝资料", "Save baby profile"],
  profileDateError: [
    "请输入有效且不晚于今天的日期（YYYY-MM-DD），或留空。",
    "Enter a valid date no later than today (YYYY-MM-DD), or leave it blank.",
  ],
  ownership: ["管理员权限", "Admin role"],
  ownershipDescription: [
    "提名一位当前成员接任。对方接受前，你仍是管理员；接受后，全部家庭数据的管理权与管理员权限一并转让，你成为普通成员。家庭和记录不变，不复制或重新导入，原始记录作者不变。",
    "Nominate an active member. You stay admin until they accept. Acceptance transfers control of all family data together with the admin role; you become an ordinary member. The family and records stay in place, with no copying or re-import. Original authorship stays unchanged.",
  ],
  nominateOwner: ["提名为管理员", "Nominate as admin"],
  nominateOwnerTitle: ["提名新管理员？", "Nominate a new admin?"],
  nominateOwnerDescription: [
    "提名 {name} 接任，并管理现有家庭的全部共享数据。只有对方接受后，你才会成为普通成员；家庭、记录和原始作者不变，不复制或重新导入数据。",
    "Nominate {name} to take over this family and control all its shared data. You become an ordinary member only after acceptance. The family, records and original authors stay unchanged; nothing is copied or re-imported.",
  ],
  ownershipPending: [
    "正在等待 {name} 接受管理员提名。",
    "Waiting for {name} to accept the admin nomination.",
  ],
  ownershipIncoming: ["你已被提名为管理员", "You have been nominated as admin"],
  ownershipIncomingDescription: [
    "接受后，现有家庭全部共享数据的管理权与你的管理员权限同时生效。你可管理邀请、成员和宝宝资料，并可修改或删除任何家庭记录。原管理员成为普通成员。所有记录仍在同一个家庭，原始作者不变，不复制或重新导入。",
    "Acceptance transfers control of all existing shared family data and activates your admin permissions together. You can manage invitations, members and the baby profile, and edit or delete any family record. The previous admin becomes an ordinary member. All records stay in the same family with their original authors; nothing is copied or re-imported.",
  ],
  acceptOwnership: ["接受管理员权限", "Accept admin role"],
  acceptOwnershipTitle: ["接任家庭管理员？", "Become the family admin?"],
  cancelOwnership: ["取消提名", "Cancel nomination"],
  cancelOwnershipTitle: ["取消管理员提名？", "Cancel the admin nomination?"],
  cancelOwnershipDescription: [
    "双方现有权限保持不变。你可以稍后重新提名。",
    "Both users keep their current permissions. You can nominate someone again later.",
  ],
  noSuccessor: [
    "还没有其他当前成员可以接任。",
    "There are no other active members to nominate.",
  ],
  closeFamily: ["关闭测试家庭", "Close test family"],
  closeFamilyTitle: ["关闭这个测试家庭？", "Close this test family?"],
  closeFamilyDescription: [
    "家庭访问将立即停止，家庭会进入删除处理流程；所有测试记录（包括已离开成员的记录）都将被删除。此设备上的家庭缓存、草稿和未发送修改也会被清除。原有离线宝宝记录不受影响。",
    "Family access stops immediately and the family enters deletion processing. All its test records, including former members’ contributions, will be deleted. This device’s family cache, drafts and unsent changes will also be cleared. Your original offline baby records are unaffected.",
  ],
  closeFamilyConsent: [
    "我了解关闭将删除整个测试家庭，而不是仅退出登录。",
    "I understand this deletes the entire test family, rather than only signing me out.",
  ],
  closeFamilyBlocked: [
    "关闭家庭前，请先移除所有其他当前成员。也可以转让管理员权限后离开。",
    "Remove every other active member before closing the family. Alternatively, transfer the admin role, then leave.",
  ],
  deletion: ["删除试点账户", "Delete pilot account"],
  deleteAccount: ["申请删除账户", "Request account deletion"],
  deleteAccountTitle: ["删除你的试点账户？", "Delete your pilot account?"],
  deleteAccountDescription: [
    "服务接受申请后，账户访问将立即停止，账户及相关服务数据会进入永久删除流程。此试点会删除你创建或最后修改的家庭记录，即使最初由其他成员创建。这与离开家庭不同：离开会保留共享记录。身份账户删除可能需要额外处理，只有服务确认完成后才算完成。原有离线宝宝记录不受影响。",
    "Once the service accepts your request, account access stops and your account and associated data enter permanent deletion processing. This pilot removes family records you created or last edited, even if another member originally created them. This differs from leaving, which keeps shared records. Identity-account deletion may need further processing and is complete only when the service confirms it. Your original offline baby records are unaffected.",
  ],
  deleteAccountConsent: [
    "我了解账户删除会删除我的关联数据，包括已共享的贡献记录。",
    "I understand account deletion removes my associated data, including shared contributions.",
  ],
  deleteAccountBlocked: [
    "你仍是家庭管理员，暂不能删除账户。请让新管理员接受转让，或先移除其他成员并关闭家庭，再回来删除账户。",
    "You still administer a family, so account deletion is blocked. Have a new admin accept a transfer, or remove other members and close the family, then return to delete your account.",
  ],
  deletionPending: ["账户删除正在处理", "Account deletion is processing"],
  deletionPendingDescription: [
    "家庭访问已停用。服务正在清理关联数据；此状态不代表身份账户已永久删除。刷新可查看处理结果。",
    "Family access is disabled. The service is removing associated data; this status does not mean the identity account has been permanently deleted. Refresh to check progress.",
  ],
  deletionIdentity: [
    "等待身份账户删除完成",
    "Waiting for identity-account deletion",
  ],
  deletionIdentityDescription: [
    "应用服务数据清理已进入身份删除阶段。身份账户尚未确认删除完成，请稍后刷新。",
    "Deletion has reached the identity-account stage. The identity account is not yet confirmed deleted. Refresh again later.",
  ],
  deletionComplete: ["账户删除已完成", "Account deletion completed"],
  deletionDone: ["完成并清除查询凭证", "Done; clear status receipt"],
  checkDeletionStatus: ["检查删除状态", "Check deletion status"],
  deletionStatusUnavailable: [
    "暂时无法确认删除结果。请保留此应用，联网后再次检查；不要把未确认状态视为已完成。",
    "Deletion status could not be confirmed. Keep the app installed, connect and check again. An unconfirmed status does not mean deletion is complete.",
  ],
  deletionReceiptUnavailable: [
    "此设备没有可用的删除查询凭证。请联系试点支持人员确认处理状态。",
    "This device has no usable deletion-status receipt. Contact pilot support to confirm the request’s status.",
  ],
  deletionRequestedAt: ["申请时间：{time}", "Requested {time}"],
  transitionPending: ["正在确认家庭变更结果", "Confirming a family change"],
  transitionDescription: [
    "为避免重复操作或带入其他家庭的数据，暂不显示或编辑家庭记录。请联网后刷新，以确认上次操作并完成此设备上的清理。",
    "Family records are temporarily hidden and editing is paused to prevent duplicate actions or carrying data between families. Connect and refresh to confirm the last action and finish cleanup on this device.",
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
  sharingIssuesTitle: [
    "共享问题与保留的修改",
    "Sharing issues and preserved changes",
  ],
  preservedDescription: [
    "这些修改没有共享，也不会自动重发。请查看最新记录，再从该记录重新编辑。这里不能把保留内容另存为新记录或带入其他家庭；可丢弃已检查的修改。",
    "These changes were not shared and will not retry automatically. Check the latest feed, then edit from that record again. Preserved content cannot be saved as a new record or moved to another family here. Discard a change once reviewed.",
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
  expandSectionAction: ["展开", "Expand"],
  collapseSectionAction: ["收起", "Collapse"],
  working: ["正在处理…", "Working…"],
  errorGeneric: [
    "暂时无法确认操作结果。请保持此页面打开，联网后刷新查看最新状态。",
    "The action’s result could not be confirmed. Keep this page open, connect and refresh to check the latest status.",
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
    "你已无法访问此测试家庭。家庭内容将停止显示并从此设备清除，包括草稿和未发送修改。已共享的记录留在家庭中。",
    "You no longer have access to this test family. Family content is hidden and cleared from this device, including drafts and unsent changes. Shared records stay with the family.",
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
    "Another member changed this record. The latest version stays and your change is kept privately for review.",
  ],
  errorActiveTimerConflict: [
    "发送时，家庭中已有同类的喂养或睡眠计时。你这次开始未共享，已保留在本机。刷新“今天”查看当前状态；如果计时仍在进行，可在那里结束。",
    "When this change was sent, a family feeding or sleep timer of the same type already existed. Your attempted start was not shared and is preserved on this device. Refresh Today to see its current status; if it is still running, you can finish it there.",
  ],
  errorTimerAlreadyFinished: [
    "此计时已在另一台设备上结束。最新家庭记录已保留；你选择的结束时间没有覆盖它，并保留在此设备供检查。",
    "This timer was already finished on another device. The latest family record is kept; your chosen end time did not overwrite it and remains on this device for review.",
  ],
  errorProfileChanged: [
    "宝宝资料已被更新。请刷新并检查最新资料，再修改和保存。",
    "The baby profile has changed. Refresh and check the latest profile before editing and saving again.",
  ],
  errorTransferUnavailable: [
    "管理员提名已失效或权限已改变。请刷新查看最新状态。",
    "The admin nomination is no longer available or permissions have changed. Refresh to check the latest status.",
  ],
  errorTransferPending: [
    "已有待接受的管理员提名。请先取消现有提名，再提名其他成员。",
    "An admin nomination is already pending. Cancel it before nominating another member.",
  ],
  errorInvitationLimit: [
    "管理员之外最多可邀请 5 人，已加入成员和有效待接受邀请均占名额。请先查看最新成员和邀请，撤销不再需要的邀请后重试。",
    "A family has up to 5 people besides the admin, including current members and valid pending invitations. Review the latest members and invitations, then revoke any unneeded invitation before retrying.",
  ],
  errorMemberChanged: [
    "这位成员的访问权限已改变，未执行旧的移除操作。请刷新，检查最新成员状态后再决定。",
    "This member’s access has changed, so the old removal was not applied. Refresh and check their latest status before deciding again.",
  ],
  errorOwnerRequired: [
    "只有当前管理员可以进行此操作。请刷新确认最新权限。",
    "Only the current admin can do this. Refresh to confirm your current permissions.",
  ],
  errorRecordForbidden: [
    "你只能修改或删除自己添加的记录；管理员可以修改或删除任何记录。",
    "You can edit or delete only your own records. The admin can edit or delete any record.",
  ],
  errorAccountDeleted: [
    "此账户已进入删除流程，家庭访问已停用。请刷新查看删除状态。",
    "This account is in deletion processing and family access is disabled. Refresh to check deletion status.",
  ],
  errorMembershipChanged: [
    "家庭访问权限已改变。旧家庭内容不能再使用，也不会带入其他家庭。请刷新确认最新状态。",
    "Family access has changed. Old family content cannot be reused or carried into another family. Refresh to confirm the latest status.",
  ],
  errorHistoryChanged: [
    "试点服务的数据历史已更换。旧缓存和未发送修改不能再次使用，请刷新获取当前数据。",
    "The service’s data history has changed. Old cache and unsent work cannot be reused. Refresh to load current data.",
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
    "家庭访问权限或数据历史已改变。旧家庭缓存、草稿和未发送修改已清除，不会带入当前家庭。",
    "Family access or data history has changed. Old family cache, drafts and unsent work have been cleared and will not move into the current family.",
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
  invitation_decline_consent_required: "errorDeclineConsent",
  invitation_unavailable: "errorInvitationUnavailable",
  invitation_already_created: "errorInvitationCreated",
  record_changed: "errorRecordChanged",
  active_timer_conflict: "errorActiveTimerConflict",
  timer_already_finished: "errorTimerAlreadyFinished",
  profile_changed: "errorProfileChanged",
  transfer_unavailable: "errorTransferUnavailable",
  transfer_pending: "errorTransferPending",
  invitation_limit: "errorInvitationLimit",
  member_changed: "errorMemberChanged",
  family_has_members: "closeFamilyBlocked",
  family_owner_cannot_delete: "deleteAccountBlocked",
  owner_cannot_leave: "deleteAccountBlocked",
  owner_required: "errorOwnerRequired",
  record_forbidden: "errorRecordForbidden",
  account_deleted: "errorAccountDeleted",
  deletion_status_unavailable: "deletionStatusUnavailable",
  deletion_pending: "deletionPendingDescription",
  deletion_receipt_unavailable: "deletionReceiptUnavailable",
  transition_pending: "transitionDescription",
  membership_changed: "errorMembershipChanged",
  history_changed: "errorHistoryChanged",
  invalid_input: "errorInvalidInput",
  rate_limited: "errorRateLimited",
  family_record_limit: "errorFamilyQuota",
  family_storage_limit: "errorFamilyQuota",
  family_snapshot_limit: "errorFamilyQuota",
  family_member_history_limit: "errorFamilyQuota",
  family_creation_limit: "errorFamilyCreationLimit",
  recovery_blocked: "errorRecoveryBlocked",
  reminder_cleanup_failed: "errorReminderCleanup",
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
  watch_pending: "errorWatchPending",
};

export function familyErrorMessage(locale: AppLocale, code: string): string {
  if (code === "supplement_sharing_unavailable")
    return locale === "zh-CN"
      ? "家庭服务尚未支持补充剂记录，请更新 API 后刷新。原本机资料不会因此清理。"
      : "Supplement sharing needs an API update. Refresh after updating. Your personal data will not be cleared.";
  if (code === "extras_sharing_unavailable")
    return locale === "zh-CN"
      ? "服务尚未支持照片、提醒和早教共享，请先更新数据库与 API，再刷新重试。原本机资料不会因此清理。"
      : "Photo, reminder and play sharing require the database and API update. Refresh after updating. Existing personal data will not be cleared by this error.";
  if (code.startsWith("legacy_reminder_"))
    return familyMessage(locale, "ownerLegacyReminderError");
  if (
    [
      "avatar_read_failed",
      "invalid_extra_record",
      "owner_extra_read_failed",
    ].includes(code)
  )
    return familyMessage(locale, "ownerExtraReadError");
  if (code === "family_schema_unsupported")
    return locale === "zh-CN"
      ? "此家庭的数据格式暂不受当前应用支持。请联系家庭管理员处理；你可以在“我的账户”中退出登录。本机个人资料不会因此删除。"
      : "This family’s data format is not supported by this app. Contact the family admin for help; you can sign out from My account. Your personal data on this device will not be deleted by this error.";
  if (code === "full_sharing_unavailable")
    return locale === "zh-CN"
      ? "服务或家庭尚未支持完整记录。请更新服务后重试。"
      : "The service or family does not support complete records yet. Update the service and retry.";
  if (code === "running_timers")
    return familyMessage(locale, "ownerTimerError");
  if (code === "identity_not_supported")
    return locale === "zh-CN"
      ? "此账户不可访问家庭服务。已清除此设备的家庭缓存。"
      : "This account cannot access family services. Family data cached on this device has been cleared.";
  if (code === "refresh_required")
    return locale === "zh-CN"
      ? "请联网刷新家庭权限后继续。"
      : "Connect and refresh family access to continue.";
  return fullFamilyMessage(locale, errorMessages[code] ?? "errorGeneric");
}

const fullMessages: Partial<Record<FamilyMessageKey, [string, string]>> = {
  noticeSignedOut: [
    "已退出登录，此设备上的家庭数据和登录信息已清除。已共享记录仍保留在家庭中。",
    "Signed out. Family data and sign-in details have been cleared from this device. Shared records remain with the family.",
  ],
  noticeReviewAsNew: [
    "原记录已不存在。请检查保留的内容；再次保存会创建一条新记录。",
    "The original record no longer exists. Review the preserved content; saving again will create a new record.",
  ],
  errorNotAdmitted: [
    "此账户暂时无法使用家庭共享服务。请联系支持人员检查账户访问权限。",
    "This account cannot currently use family sharing. Contact support to check account access.",
  ],
  errorRevoked: [
    "你已无法访问此家庭。家庭内容将停止显示并从此设备清除，包括草稿和未发送修改。已共享的记录留在家庭中。",
    "You no longer have access to this family. Family content is hidden and cleared from this device, including drafts and unsent changes. Shared records stay with the family.",
  ],
  errorAlreadyFamily: [
    "此账户已加入一个家庭。每个账户只能加入一个家庭。",
    "This account already belongs to a family. Each account can belong to one family.",
  ],
  errorSignInFailed: [
    "暂时无法完成登录。请重试；如果问题持续，请联系支持人员。",
    "Sign-in could not be completed. Try again; if the problem continues, contact support.",
  ],
  errorSessionChanged: [
    "当前账户已改变。请在“我的账户”中确认登录账户后继续。",
    "The active account has changed. Check the signed-in account in My account before continuing.",
  ],
  errorLocalData: [
    "无法读取此设备上的家庭数据。请保留应用和现有数据，并联系支持人员检查。",
    "Family data on this device could not be read. Keep the app and its data, and contact support to investigate.",
  ],
  errorSignOutFirst: [
    "更换账户前请先退出。退出会清除此设备上的家庭缓存、私人草稿和待发送修改。已共享记录仍留在家庭中。",
    "Sign out before changing accounts. Signing out clears this device’s family cache, private drafts and unsent changes. Shared records remain with the family.",
  ],
  errorSignOutFailed: [
    "已停止此页面的家庭连接，但未能完成此设备上的退出清理。请保持页面打开并重试退出，完成清理后再登录。已共享记录仍留在家庭中。",
    "Family activity on this page has stopped, but cleanup on this device did not finish. Keep this page open and retry sign out before signing in again. Shared records remain with the family.",
  ],
  errorFamilyUnavailable: [
    "当前没有可访问的家庭。请刷新，或接受一条有效邀请。",
    "No family is currently available. Refresh or accept a valid invitation.",
  ],
  errorQueueFull: [
    "此设备上待处理的家庭修改已达上限。请连接服务发送修改，或检查并丢弃不再需要的保留内容。",
    "This device has reached the limit for unresolved family changes. Connect to send saved changes, or review and discard preserved changes you no longer need.",
  ],
  deletionReceiptUnavailable: [
    "此设备没有可用的删除查询凭证。请联系支持人员确认处理状态。",
    "This device has no usable deletion-status receipt. Contact support to confirm the request’s status.",
  ],
  ownerEmails: ["家人邮箱（最多 5 个）", "Family emails (up to 5)"],
  ownerEmailError: [
    "请填写 1–5 个有效且不同的家人邮箱。",
    "Enter 1–5 valid, different family email addresses.",
  ],
  title: ["家庭共享", "Family sharing"],
  account: ["我的账户", "My account"],
  deleteAccountDescription: [
    "服务接受删除申请后会立即停用账户访问，并处理关联资料及身份账户的永久删除。账户删除会清理你创建或最后编辑的家庭记录（包括最初由别人创建的记录）；普通退出则保留家庭贡献。身份删除只有在服务确认后才算完成。已迁移的原本机资料不会恢复。",
    "Once accepted, account access stops and associated data and identity enter permanent deletion processing. Account deletion removes family records you created or last edited, including records originally created by someone else; ordinary departure retains contributions. Identity deletion is complete only when the service confirms it. Previously migrated local data is not restored.",
  ],
  signIn: ["登录", "Login"],
  leave: ["离开家庭", "Leave family"],
  leaveTitle: ["离开这个家庭？", "Leave this family?"],
  leaveDescription: [
    "你将失去此家庭全部记录的访问权，包括自己添加的记录。本设备的家庭缓存、草稿和未发送修改会清理；已被服务器接受的记录留在家庭。重新加入需要新邀请，已迁移的原本机资料不会恢复。",
    "You will lose access to every family record, including your own. This device’s family cache, drafts and unsent changes will be cleared; accepted records remain with the family. Rejoining requires a new invitation. Previously migrated local data is not restored.",
  ],
  removeDescription: [
    "{name} 将立即失去家庭访问权，未使用邀请同时失效；已共享记录仍保留。",
    "{name} will immediately lose family access and unused invitations will be revoked. Shared records remain.",
  ],
  closeFamily: ["关闭家庭", "Close family"],
  closeFamilyTitle: ["关闭这个家庭？", "Close this family?"],
  closeFamilyDescription: [
    "家庭访问将立即停止，家庭进入删除处理，全部家庭记录（包括已离开成员的贡献）会被清理。本机缓存、草稿和未发送修改也会清除，已迁移的原本机资料不会恢复。",
    "Family access stops immediately and the family enters deletion processing. All family records, including former members’ contributions, will be purged. Local cache, drafts and unsent work will also be cleared. Previously migrated local data is not restored.",
  ],
  closeFamilyConsent: [
    "我了解这会关闭并删除整个家庭，而不是仅退出登录。",
    "I understand this closes and deletes the whole family, rather than only signing me out.",
  ],
  deletion: ["删除账户", "Delete account"],
  deleteAccountTitle: ["删除你的账户？", "Delete your account?"],
  pilotNotice: [
    "首次创建将共享你确认的完整宝宝记录；加入家庭将下载管理员的记录。之后在主界面记录和照护。",
    "Creating a family shares the complete baby history you review. Joining downloads the admin’s family records. Continue recording in the main app.",
  ],
  noticeNotShared: [
    "有修改未能共享，已保留在本机。请到「家庭共享」页面下方的「{section}」查看并处理。",
    "A change could not be shared and is preserved on this device. Review it in “{section}” further down the Family sharing page.",
  ],
  signInDescription: [
    "登录后可邀请家人，或接受家庭邀请。",
    "Sign in to invite family members or accept a family invitation.",
  ],
  unconfigured: ["家庭服务尚未配置", "Family service is not configured"],
  unconfiguredDescription: [
    "此版本尚未连接家庭服务。离线记录仍可正常使用。",
    "This build is not connected to family services. Offline records remain available.",
  ],
  nativeOnlyDescription: [
    "家庭登录与共享在手机应用中提供。",
    "Family sign-in and sharing are available in the mobile app.",
  ],
  signOutTitle: ["退出家庭账户？", "Sign out of your family account?"],
  signOutDescription: [
    "将清除此设备上的全部家庭数据、草稿和登录信息。已共享记录仍留在家庭。",
    "All family data, drafts and sign-in details will be cleared from this device. Shared records remain with the family.",
  ],
  signOutWithWork: [
    "退出将丢弃本设备上的未发送修改和草稿，并清除全部家庭缓存。已共享记录仍留在家庭。",
    "Signing out discards unsent changes and drafts and clears all family data from this device. Shared records remain with the family.",
  ],
  signOutDuringTransition: [
    "上次家庭操作尚未确认，服务端可能已经完成。退出登录会丢弃本设备上的家庭缓存、草稿、未发送修改和重试意图，并清除登录信息；不会撤销服务端已接受的操作。下次登录会刷新最新状态。已保存的账户删除查询凭证会保留，方便继续查询删除进度。",
    "The previous family action is unconfirmed and may have completed on the server. Signing out discards this device’s family cache, drafts, unsent changes and retry intent, and clears sign-in details. It does not undo operations already accepted by the server. Your next sign-in refreshes the latest status. Any saved account-deletion receipt is kept so you can still check its progress.",
  ],
  oneFamily: [
    "每个账户只能加入一个家庭。",
    "Each account can belong to one family.",
  ],
  family: ["家庭", "Family"],
  babyName: ["宝宝名字", "Baby name"],
  ownerSetupLocalNotice: [
    "确认后将上传下面全部资料，包括宝宝头像、提醒规则、早教打卡和早教设置，并创建家庭及保存邀请。激活成功后清理本机旧资料和恢复副本；通知需由每个成员在自己的手机单独启用。",
    "Confirmation uploads the data below, including the baby photo, reminder rules, play check-ins and play settings, creates the family and saves invitations. Successful activation clears old personal data and recovery copies. Each member enables notifications separately on their phone.",
  ],
  ownerConsent: [
    "我已查看全部初始资料和邀请邮箱，同意上传并与家人共享；激活后清理本机旧资料，受邀人的个人记录不会合并。",
    "I reviewed the starting data and invitation emails and agree to upload and share them. Activation clears the old local data. Invitees’ personal records are not merged.",
  ],
  ownerExclusions: [
    "宝宝头像、提醒规则、早教打卡及早教设置会上传；语言、主题、视图偏好和手机通知权限不共享。请先结束正在计时的喂养或睡眠。",
    "The baby photo, reminder rules, play check-ins and play settings are uploaded. Language, theme, view preferences and device notification permission are not shared. Finish running feeding or sleep timers first.",
  ],
  ownerGenericError: [
    "暂时无法完成设置。请查看家庭操作状态并刷新；未确认结果时不要重新创建。",
    "Setup could not finish. Check the family action status and refresh; do not create another family while the result is unconfirmed.",
  ],
  joinConsent: [
    "我了解加入后会下载此家庭完整记录并清理本机旧资料；我创建的共享记录也会在离开后留在家庭。同意加入成功时自动拒绝收到的其他待处理邀请。",
    "I understand that joining downloads this family’s complete records and clears old local data. My shared contributions remain with the family after I leave. I agree to decline my other pending invitations when joining succeeds.",
  ],
  acceptInviteTitle: ["加入这个家庭？", "Join this family?"],
  joinWarning: [
    "加入时会下载此家庭的完整记录；确认家庭资料已成功保存到此设备后，才会清空并替换原离线资料、恢复副本、照片、提醒、早教打卡和早教设置，不保留可恢复的个人副本。你的原有资料不会上传或合并。仅查看或取消本次确认不会清理资料。\n\n建议由宝宝资料最完整的成员创建家庭并担任首位管理员。\n\n管理员可随时移除成员，无需提前通知，服务端访问立即停止；管理员也可编辑或删除任何记录。离开或被移除后，你将失去全部家庭记录的访问权，包括自己创建的记录；已共享内容仍留在家庭。本设备检测到撤销时会清除家庭缓存和草稿。",
    "Joining downloads this family’s complete history. Only after the family data is successfully saved on this device will it clear and replace your original offline data, recovery copies, photos, reminders, play check-ins and play settings, without keeping a recoverable personal copy. Your existing data is never uploaded or merged. Reviewing or cancelling this confirmation does not clear anything.\n\nThe member with the most complete baby history should create the family and be its first admin.\n\nThe admin can remove members at any time without advance notice. Server access ends immediately. Admins can edit or delete any record. Leaving or removal ends access to all family records, including your contributions, which remain with the family. This device clears family data and drafts when revocation is detected.",
  ],
  localCache: ["已验证家庭权限与记录。", "Family access and records verified."],
};
export function fullFamilyMessage(
  locale: AppLocale,
  key: FamilyMessageKey,
  values?: Record<string, string | number>,
): string {
  const pair = fullMessages[key];
  if (!pair)
    return familyMessage(locale, key, values)
      .replaceAll("试点", "家庭共享")
      .replaceAll("pilot", "family sharing");
  let value = pair[locale === "zh-CN" ? 0 : 1];
  for (const [name, replacement] of Object.entries(values ?? {}))
    value = value.replaceAll(`{${name}}`, String(replacement));
  return value;
}

const noticeMessages: Record<string, FamilyMessageKey> = {
  sign_in_cancelled: "noticeSignInCancelled",
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
  demo = false,
): string | null {
  const key = noticeMessages[code];
  if (!key) return null;
  if (demo) return familyMessage(locale, key);
  return fullFamilyMessage(locale, key, {
    section: fullFamilyMessage(locale, "sharingIssuesTitle"),
  });
}
