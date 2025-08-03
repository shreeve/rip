ActiveRecord::Schema.define(version: 0) do

  create_table :account, primary_key: "AccountNum", id: :bigint do |t|
    t.string   :Description  , [""]
    t.integer  :AcctType!    , 1, [0], unsigned: true
    t.string   :BankNumber   , [""]
    t.integer  :Inactive!    , 1, [0], unsigned: true
    t.integer  :AccountColor!, [0]
  end

  create_table :accountingautopay, primary_key: "AccountingAutoPayNum", id: :bigint do |t|
    t.bigint   :PayType!
    t.string   :PickList, [""]
  end

  create_table :activeinstance, primary_key: "ActiveInstanceNum", id: :bigint do |t|
    t.bigint   :ComputerNum!
    t.bigint   :UserNum!
    t.bigint   :ProcessId!
    t.datetime :DateTimeLastActive!, ["0001-01-01 00:00:00"]
    t.datetime :DateTRecorded!     , ["0001-01-01 00:00:00"]
    t.integer  :ConnectionType!    , 1

    t.index    :ComputerNum, name: "ComputerNum"
    t.index    :ProcessId, name: "ProcessId"
    t.index    :UserNum, name: "UserNum"
  end

  create_table  :adjustment, primary_key: "AdjNum", id: :bigint do |t|
    t.date      :AdjDate!        , ["0001-01-01"]
    t.float     :AdjAmt!         , 53, [0.0]
    t.bigint    :PatNum!
    t.bigint    :AdjType!
    t.bigint    :ProvNum!
    t.text      :AdjNote
    t.date      :ProcDate!       , ["0001-01-01"]
    t.bigint    :ProcNum!
    t.date      :DateEntry!      , ["0001-01-01"]
    t.bigint    :ClinicNum!
    t.bigint    :StatementNum!
    t.bigint    :SecUserNumEntry!
    t.timestamp :SecDateTEdit!   , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.bigint    :TaxTransID!

    t.index    [:AdjDate, :PatNum], name: "AdjDatePN"
    t.index     :ClinicNum, name: "ClinicNum"
    t.index     :PatNum, name: "indexPatNum"
    t.index    [:ProcNum, :AdjAmt], name: "indexPNAmt"
    t.index     :ProcNum, name: "ProcNum"
    t.index     :ProvNum, name: "indexProvNum"
    t.index    [:SecDateTEdit, :PatNum], name: "SecDateTEditPN"
    t.index     :SecUserNumEntry, name: "SecUserNumEntry"
    t.index     :StatementNum, name: "StatementNum"
    t.index     :TaxTransID, name: "TaxTransID"
  end

  create_table :alertcategory, primary_key: "AlertCategoryNum", id: :bigint do |t|
    t.integer  :IsHQCategory!, 1
    t.string   :InternalName!
    t.string   :Description!
  end

  create_table :alertcategorylink, primary_key: "AlertCategoryLinkNum", id: :bigint do |t|
    t.bigint   :AlertCategoryNum!
    t.integer  :AlertType!       , 1

    t.index    :AlertCategoryNum, name: "AlertCategoryNum"
  end

  create_table :alertitem, primary_key: "AlertItemNum", id: :bigint do |t|
    t.bigint   :ClinicNum!
    t.string   :Description!  , 2000
    t.integer  :Type!         , 1
    t.integer  :Severity!     , 1
    t.integer  :Actions!      , 1
    t.integer  :FormToOpen!   , 1
    t.bigint   :FKey!
    t.string   :ItemValue!    , 4000
    t.bigint   :UserNum!
    t.datetime :SecDateTEntry!, ["0001-01-01 00:00:00"]

    t.index    :ClinicNum, name: "ClinicNum"
    t.index    :FKey, name: "FKey"
    t.index    :UserNum, name: "UserNum"
  end

  create_table :alertread, primary_key: "AlertReadNum", id: :bigint do |t|
    t.bigint   :AlertItemNum!
    t.bigint   :UserNum!

    t.index    :AlertItemNum, name: "AlertItemNum"
    t.index    :UserNum, name: "UserNum"
  end

  create_table :alertsub, primary_key: "AlertSubNum", id: :bigint do |t|
    t.bigint   :UserNum!
    t.bigint   :ClinicNum!
    t.integer  :Type!            , 1
    t.bigint   :AlertCategoryNum!

    t.index    :AlertCategoryNum, name: "AlertCategoryNum"
    t.index    :ClinicNum, name: "ClinicNum"
    t.index    :UserNum, name: "UserNum"
  end

  create_table  :allergy, primary_key: "AllergyNum", id: :bigint do |t|
    t.bigint    :AllergyDefNum!
    t.bigint    :PatNum!
    t.string    :Reaction!
    t.integer   :StatusIsActive!     , 1
    t.timestamp :DateTStamp!         , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.date      :DateAdverseReaction!, ["0001-01-01"]
    t.string    :SnomedReaction!

    t.index     :AllergyDefNum, name: "AllergyDefNum"
    t.index     :PatNum, name: "PatNum"
  end

  create_table  :allergydef, primary_key: "AllergyDefNum", id: :bigint do |t|
    t.string    :Description!
    t.integer   :IsHidden!     , 1
    t.timestamp :DateTStamp!   , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.integer   :SnomedType    , 1
    t.bigint    :MedicationNum!
    t.string    :UniiCode!

    t.index     :MedicationNum, name: "MedicationNum"
  end

  create_table :anestheticdata, primary_key: "AnestheticDataNum" do |t|
    t.integer  :AnestheticRecordNum!
    t.string   :AnesthOpen          , 32
    t.string   :AnesthClose         , 32
    t.string   :SurgOpen            , 32
    t.string   :SurgClose           , 32
    t.string   :Anesthetist         , 32
    t.string   :Surgeon             , 32
    t.string   :Asst                , 32
    t.string   :Circulator          , 32
    t.string   :VSMName             , 20
    t.string   :VSMSerNum           , 20
    t.string   :ASA                 , 3
    t.string   :ASA_EModifier       , 1
    t.integer  :O2LMin              , 2
    t.integer  :N2OLMin             , 2
    t.boolean  :RteNasCan
    t.boolean  :RteNasHood
    t.boolean  :RteETT
    t.boolean  :MedRouteIVCath
    t.boolean  :MedRouteIVButtFly
    t.boolean  :MedRouteIM
    t.boolean  :MedRoutePO
    t.boolean  :MedRouteNasal
    t.boolean  :MedRouteRectal
    t.string   :IVSite              , 20
    t.integer  :IVGauge             , 2
    t.integer  :IVSideR             , 2
    t.integer  :IVSideL             , 2
    t.integer  :IVAtt               , 2
    t.string   :IVF                 , 20
    t.float    :IVFVol
    t.boolean  :MonBP
    t.boolean  :MonSpO2
    t.boolean  :MonEtCO2
    t.boolean  :MonTemp
    t.boolean  :MonPrecordial
    t.boolean  :MonEKG
    t.text     :Notes
    t.integer  :PatWgt              , 2
    t.boolean  :WgtUnitsLbs
    t.boolean  :WgtUnitsKgs
    t.integer  :PatHgt              , 2
    t.string   :EscortName          , 32
    t.string   :EscortCellNum       , 13
    t.string   :EscortRel           , 16
    t.string   :NPOTime             , 5
    t.boolean  :HgtUnitsIn
    t.boolean  :HgtUnitsCm
    t.text     :Signature
    t.integer  :SigIsTopaz          , 1, [0], unsigned: true

    t.index    :AnestheticRecordNum, name: "AnestheticRecordNum"
  end

  create_table :anestheticrecord, primary_key: "AnestheticRecordNum" do |t|
    t.integer  :PatNum!
    t.datetime :AnestheticDate!
    t.integer  :ProvNum!       , 2

    t.index    :PatNum, name: "PatNum"
    t.index    :ProvNum, name: "ProvNum"
  end

  create_table :anesthmedsgiven, primary_key: "AnestheticMedNum" do |t|
    t.integer  :AnestheticRecordNum!
    t.string   :AnesthMedName       , 32
    t.float    :QtyGiven            , 53
    t.float    :QtyWasted           , 53
    t.string   :DoseTimeStamp       , 32
    t.float    :QtyOnHandOld        , 53
    t.integer  :AnesthMedNum!
  end

  create_table :anesthmedsintake, primary_key: "AnestheticMedNum" do |t|
    t.datetime :IntakeDate!
    t.string   :AnesthMedName , 32
    t.integer  :Qty!
    t.string   :SupplierIDNum!, 11
    t.string   :InvoiceNum!   , 20
  end

  create_table :anesthmedsinventory, primary_key: "AnestheticMedNum" do |t|
    t.string   :AnesthMedName     , 30
    t.string   :AnesthHowSupplied!, 20
    t.float    :QtyOnHand         , 53, [0.0]
    t.string   :DEASchedule       , 3
  end

  create_table :anesthmedsinventoryadj, primary_key: "AdjustNum" do |t|
    t.integer  :AnestheticMedNum!
    t.float    :QtyAdj           , 53
    t.integer  :UserNum!
    t.string   :Notes
    t.datetime :TimeStamp!

    t.index    :AnestheticMedNum, name: "AnestheticMedNum"
  end

  create_table :anesthmedsuppliers, primary_key: "SupplierIDNum" do |t|
    t.string   :SupplierName!
    t.string   :Phone        , 13
    t.string   :PhoneExt     , 6
    t.string   :Fax          , 13
    t.string   :Addr1        , 48
    t.string   :Addr2        , 32
    t.string   :City         , 48
    t.string   :State        , 20
    t.string   :Zip          , 10
    t.string   :Contact      , 32
    t.string   :WebSite      , 48
    t.text     :Notes
  end

  create_table :anesthscore, primary_key: "AnesthScoreNum" do |t|
    t.integer  :AnestheticRecordNum
    t.integer  :QActivity          , 2
    t.integer  :QResp              , 2
    t.integer  :QCirc              , 2
    t.integer  :QConc              , 2
    t.integer  :QColor             , 2
    t.integer  :AnesthesiaScore    , 2
    t.boolean  :DischAmb
    t.boolean  :DischWheelChr
    t.boolean  :DischAmbulance
    t.boolean  :DischCondStable
    t.boolean  :DischCondUnStable

    t.index    :AnestheticRecordNum, name: "AnestheticRecordNum"
  end

  create_table :anesthvsdata, primary_key: "AnesthVSDataNum" do |t|
    t.integer  :AnestheticRecordNum!
    t.integer  :PatNum
    t.string   :VSMName             , 20
    t.string   :VSMSerNum           , 32
    t.integer  :BPSys               , 2
    t.integer  :BPDias              , 2
    t.integer  :BPMAP               , 2
    t.integer  :HR                  , 2
    t.integer  :SpO2                , 2
    t.integer  :EtCo2               , 2
    t.integer  :Temp                , 2
    t.string   :VSTimeStamp         , 32
    t.string   :MessageID           , 50
    t.text     :HL7Message          , size: :long
  end

  create_table :apikey, primary_key: "APIKeyNum", id: :bigint do |t|
    t.string   :CustApiKey!
    t.string   :DevName!
  end

  create_table :apisubscription, primary_key: "ApiSubscriptionNum", id: :bigint do |t|
    t.string   :EndPointUrl!
    t.string   :Workstation!
    t.string   :CustomerKey!
    t.string   :WatchTable!
    t.integer  :PollingSeconds!
    t.string   :UiEventType!
    t.datetime :DateTimeStart! , ["0001-01-01 00:00:00"]
    t.datetime :DateTimeStop!  , ["0001-01-01 00:00:00"]
    t.string   :Note!

    t.index    :PollingSeconds, name: "PollingSeconds"
  end

  create_table  :appointment, primary_key: "AptNum", id: :bigint do |t|
    t.bigint    :PatNum!
    t.integer   :AptStatus!            , 1, [0], unsigned: true
    t.string    :Pattern               , [""]
    t.bigint    :Confirmed!
    t.boolean   :TimeLocked!
    t.bigint    :Op!
    t.text      :Note
    t.bigint    :ProvNum!
    t.bigint    :ProvHyg!
    t.datetime  :AptDateTime!          , ["0001-01-01 00:00:00"]
    t.bigint    :NextAptNum!
    t.bigint    :UnschedStatus!
    t.integer   :IsNewPatient!         , 1, [0], unsigned: true
    t.string    :ProcDescript          , [""]
    t.bigint    :Assistant!
    t.bigint    :ClinicNum!
    t.integer   :IsHygiene!            , 1, [0], unsigned: true
    t.timestamp :DateTStamp!           , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.datetime  :DateTimeArrived!
    t.datetime  :DateTimeSeated!
    t.datetime  :DateTimeDismissed!
    t.bigint    :InsPlan1!
    t.bigint    :InsPlan2!
    t.datetime  :DateTimeAskedToArrive!, ["0001-01-01 00:00:00"]
    t.text      :ProcsColored!
    t.integer   :ColorOverride!
    t.bigint    :AppointmentTypeNum!
    t.bigint    :SecUserNumEntry!
    t.datetime  :SecDateTEntry!        , ["0001-01-01 00:00:00"]
    t.integer   :Priority!             , 1
    t.string    :ProvBarText!          , 60
    t.string    :PatternSecondary!
    t.string    :SecurityHash!

    t.index     :AppointmentTypeNum, name: "AppointmentTypeNum"
    t.index     :AptDateTime, name: "indexAptDateTime"
    t.index    [:AptStatus, :AptDateTime, :ClinicNum], name: "StatusDate"
    t.index     :ClinicNum, name: "ClinicNum"
    t.index     :DateTimeArrived, name: "DateTimeArrived"
    t.index     :InsPlan1, name: "InsPlan1"
    t.index     :InsPlan2, name: "InsPlan2"
    t.index     :NextAptNum, name: "indexNextAptNum"
    t.index     :Op, name: "Op"
    t.index     :PatNum, name: "indexPatNum"
    t.index     :Priority, name: "Priority"
    t.index     :ProvHyg, name: "indexProvHyg"
    t.index     :ProvNum, name: "indexProvNum"
    t.index     :SecUserNumEntry, name: "SecUserNumEntry"
    t.index     :UnschedStatus, name: "UnschedStatus"
  end

  create_table :appointmentrule, primary_key: "AppointmentRuleNum", id: :bigint do |t|
    t.string   :RuleDesc  , [""]
    t.string   :CodeStart , 15
    t.string   :CodeEnd   , 15
    t.integer  :IsEnabled!, 1, [0], unsigned: true
  end

  create_table :appointmenttype, primary_key: "AppointmentTypeNum", id: :bigint do |t|
    t.string   :AppointmentTypeName!
    t.integer  :AppointmentTypeColor!
    t.integer  :ItemOrder!
    t.integer  :IsHidden!            , 1
    t.string   :Pattern!
    t.string   :CodeStr!             , 4000
  end

  create_table :apptfield, primary_key: "ApptFieldNum", id: :bigint do |t|
    t.bigint   :AptNum!
    t.string   :FieldName!
    t.text     :FieldValue!

    t.index    :AptNum, name: "AptNum"
  end

  create_table :apptfielddef, primary_key: "ApptFieldDefNum", id: :bigint do |t|
    t.string   :FieldName!
    t.integer  :FieldType!, 1
    t.text     :PickList!
    t.integer  :ItemOrder!
  end

  create_table :apptgeneralmessagesent, primary_key: "ApptGeneralMessageSentNum", id: :bigint do |t|
    t.bigint   :ApptNum!
    t.bigint   :PatNum!
    t.bigint   :ClinicNum!
    t.datetime :DateTimeEntry!      , ["0001-01-01 00:00:00"]
    t.bigint   :TSPrior!
    t.bigint   :ApptReminderRuleNum!
    t.integer  :SendStatus!         , 1
    t.datetime :ApptDateTime!       , ["0001-01-01 00:00:00"]
    t.integer  :MessageType!        , 1
    t.bigint   :MessageFk!
    t.datetime :DateTimeSent!       , ["0001-01-01 00:00:00"]
    t.text     :ResponseDescript!

    t.index    :ApptNum, name: "ApptNum"
    t.index    :ApptReminderRuleNum, name: "ApptReminderRuleNum"
    t.index    :ClinicNum, name: "ClinicNum"
    t.index    :MessageFk, name: "MessageFk"
    t.index    :PatNum, name: "PatNum"
  end

  create_table :apptreminderrule, primary_key: "ApptReminderRuleNum", id: :bigint do |t|
    t.integer  :TypeCur!                   , 1
    t.bigint   :TSPrior!
    t.string   :SendOrder!
    t.integer  :IsSendAll!                 , 1
    t.text     :TemplateSMS!
    t.text     :TemplateEmailSubject!
    t.text     :TemplateEmail!
    t.bigint   :ClinicNum!
    t.text     :TemplateSMSAggShared!
    t.text     :TemplateSMSAggPerAppt!
    t.text     :TemplateEmailSubjAggShared!
    t.text     :TemplateEmailAggShared!
    t.text     :TemplateEmailAggPerAppt!
    t.bigint   :DoNotSendWithin!
    t.integer  :IsEnabled!                 , 1
    t.text     :TemplateAutoReply!
    t.text     :TemplateAutoReplyAgg!
    t.integer  :IsAutoReplyEnabled!        , 1
    t.string   :Language!
    t.text     :TemplateComeInMessage!
    t.string   :EmailTemplateType!
    t.string   :AggEmailTemplateType!
    t.integer  :IsSendForMinorsBirthday!   , 1
    t.bigint   :EmailHostingTemplateNum!
    t.integer  :MinorAge!
    t.text     :TemplateFailureAutoReply!
    t.integer  :SendMultipleInvites!       , 1
    t.bigint   :TimeSpanMultipleInvites!

    t.index    :ClinicNum, name: "ClinicNum"
    t.index    :EmailHostingTemplateNum, name: "EmailHostingTemplateNum"
    t.index    :TSPrior, name: "TSPrior"
  end

  create_table :apptremindersent, primary_key: "ApptReminderSentNum", id: :bigint do |t|
    t.bigint   :ApptNum!
    t.datetime :ApptDateTime!       , ["0001-01-01 00:00:00"]
    t.datetime :DateTimeSent!       , ["0001-01-01 00:00:00"]
    t.bigint   :TSPrior!
    t.bigint   :ApptReminderRuleNum!
    t.bigint   :PatNum!
    t.bigint   :ClinicNum!
    t.integer  :SendStatus!         , 1
    t.integer  :MessageType!        , 1
    t.bigint   :MessageFk!
    t.datetime :DateTimeEntry!      , ["0001-01-01 00:00:00"]
    t.text     :ResponseDescript!

    t.index    :ApptNum, name: "ApptNum"
    t.index    :ApptReminderRuleNum, name: "ApptReminderRuleNum"
    t.index    :ClinicNum, name: "ClinicNum"
    t.index    :MessageFk, name: "MessageFk"
    t.index    :PatNum, name: "PatNum"
    t.index    :TSPrior, name: "TSPrior"
  end

  create_table :apptthankyousent, primary_key: "ApptThankYouSentNum", id: :bigint do |t|
    t.bigint   :ApptNum!
    t.datetime :ApptDateTime!            , ["0001-01-01 00:00:00"]
    t.datetime :ApptSecDateTEntry!       , ["0001-01-01 00:00:00"]
    t.bigint   :TSPrior!
    t.bigint   :ApptReminderRuleNum!
    t.bigint   :ClinicNum!
    t.bigint   :PatNum!
    t.text     :ResponseDescript!
    t.datetime :DateTimeThankYouTransmit!, ["0001-01-01 00:00:00"]
    t.string   :ShortGUID!
    t.integer  :SendStatus!              , 1
    t.integer  :DoNotResend!             , 1
    t.integer  :MessageType!             , 1
    t.bigint   :MessageFk!
    t.datetime :DateTimeEntry!           , ["0001-01-01 00:00:00"]
    t.datetime :DateTimeSent!            , ["0001-01-01 00:00:00"]

    t.index    :ApptDateTime, name: "ApptDateTime"
    t.index    :ApptNum, name: "ApptNum"
    t.index    :ApptReminderRuleNum, name: "ApptReminderRuleNum"
    t.index    :ClinicNum, name: "ClinicNum"
    t.index    :MessageFk, name: "MessageFk"
    t.index    :PatNum, name: "PatNum"
    t.index    :TSPrior, name: "TSPrior"
  end

  create_table :apptview, primary_key: "ApptViewNum", id: :bigint do |t|
    t.string   :Description           , [""]
    t.integer  :ItemOrder!            , 2, [0], unsigned: true
    t.integer  :RowsPerIncr!          , 1, [1], unsigned: true
    t.integer  :OnlyScheduledProvs!   , 1, unsigned: true
    t.time     :OnlySchedBeforeTime!
    t.time     :OnlySchedAfterTime!
    t.integer  :StackBehavUR!         , 1
    t.integer  :StackBehavLR!         , 1
    t.bigint   :ClinicNum!
    t.time     :ApptTimeScrollStart!
    t.integer  :IsScrollStartDynamic! , 1
    t.integer  :IsApptBubblesDisabled!, 1
    t.integer  :WidthOpMinimum!       , 2, unsigned: true
    t.integer  :WaitingRmName!        , 1

    t.index    :ClinicNum, name: "ClinicNum"
  end

  create_table :apptviewitem, primary_key: "ApptViewItemNum", id: :bigint do |t|
    t.bigint   :ApptViewNum!
    t.bigint   :OpNum!
    t.bigint   :ProvNum!
    t.string   :ElementDesc      , [""]
    t.integer  :ElementOrder!    , 1, [0], unsigned: true
    t.integer  :ElementColor!    , [0]
    t.integer  :ElementAlignment!, 1
    t.bigint   :ApptFieldDefNum!
    t.bigint   :PatFieldDefNum!
    t.integer  :IsMobile!        , 1

    t.index    :OpNum, name: "OpNum"
    t.index    :ProvNum, name: "ProvNum"
  end

  create_table :asapcomm, primary_key: "AsapCommNum", id: :bigint do |t|
    t.bigint   :FKey!
    t.integer  :FKeyType!            , 1
    t.bigint   :ScheduleNum!
    t.bigint   :PatNum!
    t.bigint   :ClinicNum!
    t.string   :ShortGUID!
    t.datetime :DateTimeEntry!       , ["0001-01-01 00:00:00"]
    t.datetime :DateTimeExpire!      , ["0001-01-01 00:00:00"]
    t.datetime :DateTimeSmsScheduled!, ["0001-01-01 00:00:00"]
    t.integer  :SmsSendStatus!       , 1
    t.integer  :EmailSendStatus!     , 1
    t.datetime :DateTimeSmsSent!     , ["0001-01-01 00:00:00"]
    t.datetime :DateTimeEmailSent!   , ["0001-01-01 00:00:00"]
    t.bigint   :EmailMessageNum!
    t.integer  :ResponseStatus!      , 1
    t.datetime :DateTimeOrig!        , ["0001-01-01 00:00:00"]
    t.text     :TemplateText!
    t.text     :TemplateEmail!
    t.string   :TemplateEmailSubj!   , 100
    t.text     :Note!
    t.text     :GuidMessageToMobile!
    t.string   :EmailTemplateType!

    t.index    :ClinicNum, name: "ClinicNum"
    t.index    :EmailMessageNum, name: "EmailMessageNum"
    t.index    :EmailSendStatus, name: "EmailSendStatus"
    t.index    :FKey, name: "FKey"
    t.index    :PatNum, name: "PatNum"
    t.index    :ScheduleNum, name: "ScheduleNum"
    t.index    :ShortGUID, name: "ShortGUID"
    t.index    :SmsSendStatus, name: "SmsSendStatus"
  end

  create_table :autocode, primary_key: "AutoCodeNum", id: :bigint do |t|
    t.string   :Description   , [""]
    t.integer  :IsHidden!     , 1, [0], unsigned: true
    t.integer  :LessIntrusive!, 1, [0], unsigned: true
  end

  create_table :autocodecond, primary_key: "AutoCodeCondNum", id: :bigint do |t|
    t.bigint   :AutoCodeItemNum!
    t.integer  :Cond!           , 1, [0], unsigned: true
  end

  create_table :autocodeitem, primary_key: "AutoCodeItemNum", id: :bigint do |t|
    t.bigint   :AutoCodeNum!
    t.string   :OldCode!    , 15, [""], collation: "utf8mb3_bin"
    t.bigint   :CodeNum!
  end

  create_table :autocommexcludedate, primary_key: "AutoCommExcludeDateNum", id: :bigint do |t|
    t.bigint   :ClinicNum!
    t.datetime :DateExclude!, ["0001-01-01 00:00:00"]
  end

  create_table :automation, primary_key: "AutomationNum", id: :bigint do |t|
    t.text     :Description!
    t.integer  :Autotrigger!       , 1
    t.text     :ProcCodes!
    t.integer  :AutoAction!        , 1
    t.bigint   :SheetDefNum!
    t.bigint   :CommType!
    t.text     :MessageContent!
    t.integer  :AptStatus!         , 1
    t.bigint   :AppointmentTypeNum!
    t.integer  :PatStatus!         , 1

    t.index    :AppointmentTypeNum, name: "AppointmentTypeNum"
  end

  create_table :automationcondition, primary_key: "AutomationConditionNum", id: :bigint do |t|
    t.bigint   :AutomationNum!
    t.integer  :CompareField! , 1
    t.integer  :Comparison!   , 1
    t.string   :CompareString!

    t.index    :AutomationNum, name: "AutomationNum"
  end

  create_table :autonote, primary_key: "AutoNoteNum", id: :bigint do |t|
    t.string   :AutoNoteName, 50
    t.text     :MainText
    t.bigint   :Category!

    t.index    :Category, name: "Category"
  end

  create_table :autonotecontrol, primary_key: "AutoNoteControlNum", id: :bigint do |t|
    t.string   :Descript      , 50
    t.string   :ControlType   , 50
    t.string   :ControlLabel
    t.text     :ControlOptions
  end

  create_table  :benefit, primary_key: "BenefitNum", id: :bigint do |t|
    t.bigint    :PlanNum!
    t.bigint    :PatPlanNum!
    t.bigint    :CovCatNum!
    t.integer   :BenefitType!      , 1, [0], unsigned: true
    t.integer   :Percent!          , 1
    t.float     :MonetaryAmt!      , 53, [0.0]
    t.integer   :TimePeriod!       , 1, [0], unsigned: true
    t.integer   :QuantityQualifier!, 1, [0], unsigned: true
    t.integer   :Quantity!         , 1, [0], unsigned: true
    t.bigint    :CodeNum!
    t.integer   :CoverageLevel!
    t.datetime  :SecDateTEntry!    , ["0001-01-01 00:00:00"]
    t.timestamp :SecDateTEdit!     , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]

    t.index     :BenefitType, name: "BenefitType"
    t.index     :CodeNum, name: "CodeNum"
    t.index     :CovCatNum, name: "CovCatNum"
    t.index     :CoverageLevel, name: "CoverageLevel"
    t.index     :MonetaryAmt, name: "MonetaryAmt"
    t.index     :PatPlanNum, name: "indexPatPlanNum"
    t.index     :Percent, name: "Percent"
    t.index     :PlanNum, name: "indexPlanNum"
    t.index     :Quantity, name: "Quantity"
    t.index     :QuantityQualifier, name: "QuantityQualifier"
    t.index     :SecDateTEdit, name: "SecDateTEdit"
    t.index     :SecDateTEntry, name: "SecDateTEntry"
    t.index     :TimePeriod, name: "TimePeriod"
  end

  create_table :canadiannetwork, primary_key: "CanadianNetworkNum", id: :bigint do |t|
    t.string   :Abbrev                    , 20, [""]
    t.string   :Descript                  , [""]
    t.string   :CanadianTransactionPrefix!
    t.integer  :CanadianIsRprHandler!     , 1
  end

  create_table :carecreditwebresponse, primary_key: "CareCreditWebResponseNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.bigint   :PayNum!
    t.string   :RefNumber!
    t.float    :Amount!           , 53
    t.string   :WebToken!
    t.string   :ProcessingStatus!
    t.datetime :DateTimeEntry!    , ["0001-01-01 00:00:00"]
    t.datetime :DateTimePending!  , ["0001-01-01 00:00:00"]
    t.datetime :DateTimeCompleted!, ["0001-01-01 00:00:00"]
    t.datetime :DateTimeExpired!  , ["0001-01-01 00:00:00"]
    t.datetime :DateTimeLastError!, ["0001-01-01 00:00:00"]
    t.text     :LastResponseStr!
    t.bigint   :ClinicNum!
    t.string   :ServiceType!
    t.string   :TransType!
    t.string   :MerchantNumber!   , 20
    t.integer  :HasLogged!        , 1

    t.index    :ClinicNum, name: "ClinicNum"
    t.index    :PatNum, name: "PatNum"
    t.index    :PayNum, name: "PayNum"
  end

  create_table  :carrier, primary_key: "CarrierNum", id: :bigint do |t|
    t.string    :CarrierName                , [""]
    t.string    :Address                    , [""]
    t.string    :Address2                   , [""]
    t.string    :City                       , [""]
    t.string    :State                      , [""]
    t.string    :Zip                        , [""]
    t.string    :Phone                      , [""]
    t.string    :ElectID                    , [""]
    t.integer   :NoSendElect!               , 1, [0], unsigned: true
    t.integer   :IsCDA!                     , 1, unsigned: true
    t.string    :CDAnetVersion              , 100, [""]
    t.bigint    :CanadianNetworkNum!
    t.integer   :IsHidden!                  , 1
    t.integer   :CanadianEncryptionMethod!  , 1
    t.integer   :CanadianSupportedTypes!
    t.bigint    :SecUserNumEntry!
    t.date      :SecDateEntry!              , ["0001-01-01"]
    t.timestamp :SecDateTEdit!              , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.string    :TIN!
    t.bigint    :CarrierGroupName!
    t.integer   :ApptTextBackColor!
    t.integer   :IsCoinsuranceInverted!     , 1
    t.integer   :TrustedEtransFlags!        , 1
    t.integer   :CobInsPaidBehaviorOverride!, 1
    t.integer   :EraAutomationOverride!     , 1
    t.integer   :OrthoInsPayConsolidate!    , 1

    t.index     :CanadianNetworkNum, name: "CanadianNetworkNum"
    t.index     :CarrierGroupName, name: "CarrierGroupName"
    t.index    [:CarrierNum, :CarrierName], name: "CarrierNumName"
    t.index     :SecUserNumEntry, name: "SecUserNumEntry"
  end

  create_table :cdcrec, primary_key: "CdcrecNum", id: :bigint do |t|
    t.string   :CdcrecCode!
    t.string   :HeirarchicalCode!
    t.string   :Description!

    t.index    :CdcrecCode, name: "CdcrecCode"
  end

  create_table :cdspermission, primary_key: "CDSPermissionNum", id: :bigint do |t|
    t.bigint   :UserNum!
    t.integer  :SetupCDS!        , 1
    t.integer  :ShowCDS!         , 1
    t.integer  :ShowInfobutton!  , 1
    t.integer  :EditBibliography!, 1
    t.integer  :ProblemCDS!      , 1
    t.integer  :MedicationCDS!   , 1
    t.integer  :AllergyCDS!      , 1
    t.integer  :DemographicCDS!  , 1
    t.integer  :LabTestCDS!      , 1
    t.integer  :VitalCDS!        , 1

    t.index    :UserNum, name: "UserNum"
  end

  create_table :centralconnection, primary_key: "CentralConnectionNum", id: :bigint do |t|
    t.string   :ServerName!
    t.string   :DatabaseName!
    t.string   :MySqlUser!
    t.string   :MySqlPassword!
    t.string   :ServiceURI!
    t.string   :OdUser!
    t.string   :OdPassword!
    t.text     :Note!
    t.integer  :ItemOrder!
    t.integer  :WebServiceIsEcw!          , 1
    t.string   :ConnectionStatus!
    t.integer  :HasClinicBreakdownReports!, 1
  end

  create_table :cert, primary_key: "CertNum", id: :bigint do |t|
    t.string   :Description!
    t.string   :WikiPageLink!
    t.integer  :ItemOrder!
    t.integer  :IsHidden!       , 1
    t.bigint   :CertCategoryNum!
  end

  create_table :certemployee, primary_key: "CertEmployeeNum", id: :bigint do |t|
    t.bigint   :CertNum!
    t.bigint   :EmployeeNum!
    t.date     :DateCompleted!, ["0001-01-01"]
    t.string   :Note!
    t.bigint   :UserNum!

    t.index    :CertNum, name: "CertNum"
    t.index    :EmployeeNum, name: "EmployeeNum"
    t.index    :UserNum, name: "UserNum"
  end

  create_table :chartview, primary_key: "ChartViewNum", id: :bigint do |t|
    t.string   :Description!
    t.integer  :ItemOrder!
    t.integer  :ProcStatuses!     , 1
    t.integer  :ObjectTypes!      , 2
    t.integer  :ShowProcNotes!    , 1
    t.integer  :IsAudit!          , 1
    t.integer  :SelectedTeethOnly!, 1
    t.integer  :OrionStatusFlags!
    t.integer  :DatesShowing!     , 1
    t.integer  :IsTpCharting!     , 1
  end

  create_table  :claim, primary_key: "ClaimNum", id: :bigint do |t|
    t.bigint    :PatNum!
    t.date      :DateService!                   , ["0001-01-01"]
    t.date      :DateSent!                      , ["0001-01-01"]
    t.string    :ClaimStatus                    , 1, [""]
    t.date      :DateReceived!                  , ["0001-01-01"]
    t.bigint    :PlanNum!
    t.bigint    :ProvTreat!
    t.float     :ClaimFee!                      , 53, [0.0]
    t.float     :InsPayEst!                     , 53, [0.0]
    t.float     :InsPayAmt!                     , 53, [0.0]
    t.float     :DedApplied!                    , 53, [0.0]
    t.string    :PreAuthString                  , 40, [""]
    t.string    :IsProsthesis                   , 1, [""]
    t.date      :PriorDate!                     , ["0001-01-01"]
    t.string    :ReasonUnderPaid                , [""]
    t.string    :ClaimNote                      , 400
    t.string    :ClaimType                      , [""]
    t.bigint    :ProvBill!
    t.bigint    :ReferringProv!
    t.string    :RefNumString                   , 40, [""]
    t.integer   :PlaceService!                  , 1, [0], unsigned: true
    t.string    :AccidentRelated                , 1, [""]
    t.date      :AccidentDate!                  , ["0001-01-01"]
    t.string    :AccidentST                     , 2, [""]
    t.integer   :EmployRelated!                 , 1, [0], unsigned: true
    t.integer   :IsOrtho!                       , 1, [0], unsigned: true
    t.integer   :OrthoRemainM!                  , 1, [0], unsigned: true
    t.date      :OrthoDate!                     , ["0001-01-01"]
    t.integer   :PatRelat!                      , 1, [0], unsigned: true
    t.bigint    :PlanNum2!
    t.integer   :PatRelat2!                     , 1, [0], unsigned: true
    t.float     :WriteOff!                      , 53, [0.0]
    t.integer   :Radiographs!                   , 1, [0], unsigned: true
    t.bigint    :ClinicNum!
    t.bigint    :ClaimForm!
    t.integer   :AttachedImages!
    t.integer   :AttachedModels!
    t.string    :AttachedFlags
    t.string    :AttachmentID
    t.string    :CanadianMaterialsForwarded!    , 10
    t.string    :CanadianReferralProviderNum!   , 20
    t.integer   :CanadianReferralReason!        , 1
    t.string    :CanadianIsInitialLower!        , 5
    t.date      :CanadianDateInitialLower!      , ["0001-01-01"]
    t.integer   :CanadianMandProsthMaterial!    , 1
    t.string    :CanadianIsInitialUpper!        , 5
    t.date      :CanadianDateInitialUpper!      , ["0001-01-01"]
    t.integer   :CanadianMaxProsthMaterial!     , 1
    t.bigint    :InsSubNum!
    t.bigint    :InsSubNum2!
    t.string    :CanadaTransRefNum!
    t.date      :CanadaEstTreatStartDate!       , ["0001-01-01"]
    t.float     :CanadaInitialPayment!          , 53
    t.integer   :CanadaPaymentMode!             , 1, unsigned: true
    t.integer   :CanadaTreatDuration!           , 1, unsigned: true
    t.integer   :CanadaNumAnticipatedPayments!  , 1, unsigned: true
    t.float     :CanadaAnticipatedPayAmount!    , 53
    t.string    :PriorAuthorizationNumber!
    t.integer   :SpecialProgramCode!            , 1
    t.string    :UniformBillType!
    t.integer   :MedType!                       , 1
    t.string    :AdmissionTypeCode!
    t.string    :AdmissionSourceCode!
    t.string    :PatientStatusCode!
    t.bigint    :CustomTracking!
    t.date      :DateResent!                    , ["0001-01-01"]
    t.integer   :CorrectionType!                , 1
    t.string    :ClaimIdentifier!
    t.string    :OrigRefNum!
    t.bigint    :ProvOrderOverride!
    t.integer   :OrthoTotalM!                   , 1, unsigned: true
    t.float     :ShareOfCost!                   , 53
    t.bigint    :SecUserNumEntry!
    t.date      :SecDateEntry!                  , ["0001-01-01"]
    t.timestamp :SecDateTEdit!                  , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.bigint    :OrderingReferralNum!
    t.date      :DateSentOrig!                  , ["0001-01-01"]
    t.date      :DateIllnessInjuryPreg!         , ["0001-01-01"]
    t.integer   :DateIllnessInjuryPregQualifier!, 2
    t.date      :DateOther!                     , ["0001-01-01"]
    t.integer   :DateOtherQualifier!            , 2
    t.integer   :IsOutsideLab!                  , 1

    t.index     :ClinicNum, name: "ClinicNum"
    t.index     :CustomTracking, name: "CustomTracking"
    t.index     :InsSubNum, name: "InsSubNum"
    t.index     :InsSubNum2, name: "InsSubNum2"
    t.index     :OrderingReferralNum, name: "OrderingReferralNum"
    t.index    [:PatNum, :ClaimStatus, :ClaimType, :DateSent], name: "PatStatusTypeDate"
    t.index    [:PlanNum, :ClaimStatus, :ClaimType, :PatNum, :ClaimNum, :DateService, :ProvTreat, :ClaimFee, :ClinicNum], name: "indexOutClaimCovering"
    t.index     :PlanNum, name: "indexPlanNum"
    t.index     :ProvBill, name: "ProvBill"
    t.index     :ProvOrderOverride, name: "ProvOrderOverride"
    t.index     :ProvTreat, name: "ProvTreat"
    t.index     :SecUserNumEntry, name: "SecUserNumEntry"
  end

  create_table :claimattach, primary_key: "ClaimAttachNum", id: :bigint do |t|
    t.bigint   :ClaimNum!
    t.string   :DisplayedFileName
    t.string   :ActualFileName

    t.index    :ClaimNum, name: "ClaimNum"
  end

  create_table :claimcondcodelog, primary_key: "ClaimCondCodeLogNum", id: :bigint do |t|
    t.bigint   :ClaimNum!
    t.string   :Code0    , 2
    t.string   :Code1    , 2
    t.string   :Code2    , 2
    t.string   :Code3    , 2
    t.string   :Code4    , 2
    t.string   :Code5    , 2
    t.string   :Code6    , 2
    t.string   :Code7    , 2
    t.string   :Code8    , 2
    t.string   :Code9    , 2
    t.string   :Code10   , 2
  end

  create_table :claimform, primary_key: "ClaimFormNum", id: :bigint do |t|
    t.string   :Description , 50, [""]
    t.integer  :IsHidden!   , 1, [0], unsigned: true
    t.string   :FontName    , [""]
    t.float    :FontSize!   , [0.0], unsigned: true
    t.string   :UniqueID    , [""]
    t.integer  :PrintImages!, 1, [0], unsigned: true
    t.integer  :OffsetX!    , 2, [0]
    t.integer  :OffsetY!    , 2, [0]
    t.integer  :Width!
    t.integer  :Height!
  end

  create_table :claimformitem, primary_key: "ClaimFormItemNum", id: :bigint do |t|
    t.bigint   :ClaimFormNum!
    t.string   :ImageFileName, [""]
    t.string   :FieldName    , [""]
    t.string   :FormatString , [""]
    t.float    :XPos!        , [0.0]
    t.float    :YPos!        , [0.0]
    t.float    :Width!       , [0.0]
    t.float    :Height!      , [0.0]
  end

  create_table  :claimpayment, primary_key: "ClaimPaymentNum", id: :bigint do |t|
    t.date      :CheckDate!      , ["0001-01-01"]
    t.float     :CheckAmt!       , 53, [0.0]
    t.string    :CheckNum        , 25, [""]
    t.string    :BankBranch      , 25, [""]
    t.string    :Note            , [""]
    t.bigint    :ClinicNum!
    t.bigint    :DepositNum!
    t.string    :CarrierName     , [""]
    t.date      :DateIssued!     , ["0001-01-01"]
    t.integer   :IsPartial!      , 1
    t.bigint    :PayType!
    t.bigint    :SecUserNumEntry!
    t.date      :SecDateEntry!   , ["0001-01-01"]
    t.timestamp :SecDateTEdit!   , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.bigint    :PayGroup!

    t.index     :CheckDate, name: "CheckDate"
    t.index     :ClinicNum, name: "ClinicNum"
    t.index     :DepositNum, name: "DepositNum"
    t.index     :PayGroup, name: "PayGroup"
    t.index     :PayType, name: "PayType"
    t.index     :SecUserNumEntry, name: "SecUserNumEntry"
  end

  create_table  :claimproc, primary_key: "ClaimProcNum", id: :bigint do |t|
    t.bigint    :ProcNum!
    t.bigint    :ClaimNum!
    t.bigint    :PatNum!
    t.bigint    :ProvNum!
    t.float     :FeeBilled!           , 53, [0.0]
    t.float     :InsPayEst!           , 53, [0.0]
    t.float     :DedApplied!          , 53, [0.0]
    t.integer   :Status!              , 1, [0], unsigned: true
    t.float     :InsPayAmt!           , 53, [0.0]
    t.string    :Remarks              , [""]
    t.bigint    :ClaimPaymentNum!
    t.bigint    :PlanNum!
    t.date      :DateCP!              , ["0001-01-01"]
    t.float     :WriteOff!            , 53, [0.0]
    t.string    :CodeSent             , 15, [""]
    t.float     :AllowedOverride!     , 53
    t.integer   :Percentage!          , 1, [-1]
    t.integer   :PercentOverride!     , 1, [-1]
    t.float     :CopayAmt!            , 53, [-1.0]
    t.integer   :NoBillIns!           , 1, [0], unsigned: true
    t.float     :PaidOtherIns!        , 53, [-1.0]
    t.float     :BaseEst!             , 53, [0.0]
    t.float     :CopayOverride!       , 53, [-1.0]
    t.date      :ProcDate!            , ["0001-01-01"]
    t.date      :DateEntry!           , ["0001-01-01"]
    t.integer   :LineNumber!          , 1, unsigned: true
    t.float     :DedEst!              , 53
    t.float     :DedEstOverride!      , 53
    t.float     :InsEstTotal!         , 53
    t.float     :InsEstTotalOverride! , 53
    t.float     :PaidOtherInsOverride!, 53
    t.string    :EstimateNote!
    t.float     :WriteOffEst!         , 53
    t.float     :WriteOffEstOverride! , 53
    t.bigint    :ClinicNum!
    t.bigint    :InsSubNum!
    t.integer   :PaymentRow!
    t.bigint    :PayPlanNum!
    t.bigint    :ClaimPaymentTracking!
    t.bigint    :SecUserNumEntry!
    t.date      :SecDateEntry!        , ["0001-01-01"]
    t.timestamp :SecDateTEdit!        , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.date      :DateSuppReceived!    , ["0001-01-01"]
    t.date      :DateInsFinalized!    , ["0001-01-01"]
    t.integer   :IsTransfer!          , 1
    t.string    :ClaimAdjReasonCodes!

    t.index    [:ClaimNum, :ClaimPaymentNum, :InsPayAmt, :DateCP, :IsTransfer], name: "indexOutClaimCovering"
    t.index     :ClaimNum, name: "indexClaimNum"
    t.index    [:ClaimPaymentNum, :Status, :InsPayAmt], name: "indexCPNSIPA"
    t.index     :ClaimPaymentNum, name: "indexClaimPaymentNum"
    t.index     :ClaimPaymentTracking, name: "ClaimPaymentTracking"
    t.index     :ClinicNum, name: "ClinicNum"
    t.index     :DateCP, name: "DateCP"
    t.index     :DateSuppReceived, name: "DateSuppReceived"
    t.index    [:InsSubNum, :ProcNum, :Status, :ProcDate, :PatNum, :InsPayAmt, :InsPayEst], name: "indexTxFinder"
    t.index     :InsSubNum, name: "InsSubNum"
    t.index     :PatNum, name: "indexPatNum"
    t.index     :PayPlanNum, name: "PayPlanNum"
    t.index     :PlanNum, name: "indexPlanNum"
    t.index    [:ProcNum, :PlanNum, :Status, :InsPayAmt, :InsPayEst, :WriteOff, :NoBillIns], name: "indexAcctCov"
    t.index     :ProcNum, name: "indexProcNum"
    t.index    [:ProvNum, :DateCP], name: "indexPNDCP"
    t.index    [:ProvNum, :ProcDate], name: "indexPNPD"
    t.index     :ProvNum, name: "indexProvNum"
    t.index    [:SecDateTEdit, :PatNum], name: "SecDateTEditPN"
    t.index     :SecUserNumEntry, name: "SecUserNumEntry"
    t.index    [:Status, :PatNum, :DateCP, :PayPlanNum, :InsPayAmt, :WriteOff, :InsPayEst, :ProcDate, :ProcNum], name: "indexAgingCovering"
    t.index     :Status, name: "Status"
  end

  create_table :claimsnapshot, primary_key: "ClaimSnapshotNum", id: :bigint do |t|
    t.bigint   :ProcNum!
    t.string   :ClaimType!
    t.float    :Writeoff!       , 53
    t.float    :InsPayEst!      , 53
    t.float    :Fee!            , 53
    t.datetime :DateTEntry!     , ["0001-01-01 00:00:00"]
    t.bigint   :ClaimProcNum!
    t.integer  :SnapshotTrigger!, 1

    t.index    :ClaimProcNum, name: "ClaimProcNum"
    t.index    :ProcNum, name: "ProcNum"
  end

  create_table  :claimtracking, primary_key: "ClaimTrackingNum", id: :bigint do |t|
    t.bigint    :ClaimNum!
    t.string    :TrackingType!
    t.bigint    :UserNum!
    t.timestamp :DateTimeEntry!      , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.text      :Note!
    t.bigint    :TrackingDefNum!
    t.bigint    :TrackingErrorDefNum!

    t.index     :ClaimNum, name: "ClaimNum"
    t.index     :TrackingDefNum, name: "TrackingDefNum"
    t.index     :TrackingErrorDefNum, name: "TrackingErrorDefNum"
    t.index     :UserNum, name: "UserNum"
  end

  create_table :claimvalcodelog, primary_key: "ClaimValCodeLogNum", id: :bigint do |t|
    t.bigint   :ClaimNum!
    t.string   :ClaimField!, 5
    t.string   :ValCode!   , 2
    t.float    :ValAmount! , 53
    t.integer  :Ordinal!   , unsigned: true
  end

  create_table :clearinghouse, primary_key: "ClearinghouseNum", id: :bigint do |t|
    t.string   :Description             , [""]
    t.text     :ExportPath
    t.text     :Payors
    t.integer  :Eformat!                , 1, [0], unsigned: true
    t.string   :ISA05
    t.string   :SenderTIN
    t.string   :ISA07
    t.string   :ISA08
    t.string   :ISA15
    t.string   :Password                , [""]
    t.string   :ResponsePath            , [""]
    t.integer  :CommBridge!             , 1, [0], unsigned: true
    t.string   :ClientProgram           , [""]
    t.integer  :LastBatchNumber!        , 2, [0], unsigned: true
    t.integer  :ModemPort!              , 1, [0], unsigned: true
    t.string   :LoginID                 , [""]
    t.string   :SenderName
    t.string   :SenderTelephone
    t.string   :GS03
    t.string   :ISA02!                  , 10
    t.string   :ISA04!                  , 10
    t.string   :ISA16!                  , 2
    t.string   :SeparatorData!          , 2
    t.string   :SeparatorSegment!       , 2
    t.bigint   :ClinicNum!
    t.bigint   :HqClearinghouseNum!
    t.integer  :IsEraDownloadAllowed!   , 1, [2]
    t.integer  :IsClaimExportAllowed!   , 1, [1]
    t.integer  :IsAttachmentSendAllowed!, 1

    t.index    :ClinicNum, name: "ClinicNum"
    t.index    :HqClearinghouseNum, name: "HqClearinghouseNum"
  end

  create_table :clinic, primary_key: "ClinicNum", id: :bigint do |t|
    t.string   :Description          , [""]
    t.string   :Address              , [""]
    t.string   :Address2             , [""]
    t.string   :City                 , [""]
    t.string   :State                , [""]
    t.string   :Zip                  , [""]
    t.string   :Phone                , [""]
    t.string   :BankNumber           , [""]
    t.integer  :DefaultPlaceService! , 1, [0], unsigned: true
    t.bigint   :InsBillingProv!
    t.string   :Fax!                 , 50
    t.bigint   :EmailAddressNum!
    t.bigint   :DefaultProv!
    t.datetime :SmsContractDate!     , ["0001-01-01 00:00:00"]
    t.float    :SmsMonthlyLimit!     , 53
    t.integer  :IsMedicalOnly!       , 1
    t.string   :BillingAddress!
    t.string   :BillingAddress2!
    t.string   :BillingCity!
    t.string   :BillingState!
    t.string   :BillingZip!
    t.string   :PayToAddress!
    t.string   :PayToAddress2!
    t.string   :PayToCity!
    t.string   :PayToState!
    t.string   :PayToZip!
    t.integer  :UseBillAddrOnClaims! , 1
    t.bigint   :Region!
    t.integer  :ItemOrder!
    t.integer  :IsInsVerifyExcluded! , 1
    t.string   :Abbr!
    t.string   :MedLabAccountNum!    , 16
    t.integer  :IsConfirmEnabled!    , 1
    t.integer  :IsConfirmDefault!    , 1
    t.integer  :IsNewPatApptExcluded!, 1
    t.integer  :IsHidden!            , 1
    t.bigint   :ExternalID!
    t.string   :SchedNote!
    t.integer  :HasProcOnRx!         , 1
    t.string   :TimeZone!            , 75
    t.string   :EmailAliasOverride!

    t.index    :DefaultProv, name: "DefaultProv"
    t.index    :EmailAddressNum, name: "EmailAddressNum"
    t.index    :ExternalID, name: "ExternalID"
    t.index    :InsBillingProv, name: "InsBillingProv"
    t.index    :Region, name: "Region"
  end

  create_table :clinicerx, primary_key: "ClinicErxNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.string   :ClinicDesc!
    t.bigint   :ClinicNum!
    t.integer  :EnabledStatus!     , 1
    t.string   :ClinicId!
    t.string   :ClinicKey!
    t.string   :AccountId!         , 25
    t.bigint   :RegistrationKeyNum!

    t.index    :ClinicNum, name: "ClinicNum"
    t.index    :PatNum, name: "PatNum"
    t.index    :RegistrationKeyNum, name: "RegistrationKeyNum"
  end

  create_table :clinicpref, primary_key: "ClinicPrefNum", id: :bigint do |t|
    t.bigint   :ClinicNum!
    t.string   :PrefName!
    t.text     :ValueString!

    t.index    :ClinicNum, name: "ClinicNum"
  end

  create_table :clockevent, primary_key: "ClockEventNum", id: :bigint do |t|
    t.bigint   :EmployeeNum!
    t.datetime :TimeEntered1!      , ["0001-01-01 00:00:00"]
    t.datetime :TimeDisplayed1!    , ["0001-01-01 00:00:00"]
    t.integer  :ClockStatus!       , 1, [0], unsigned: true
    t.text     :Note
    t.datetime :TimeEntered2!      , ["0001-01-01 00:00:00"]
    t.datetime :TimeDisplayed2!    , ["0001-01-01 00:00:00"]
    t.time     :OTimeHours!
    t.time     :OTimeAuto!
    t.time     :Adjust!
    t.time     :AdjustAuto!
    t.integer  :AdjustIsOverridden!, 1
    t.time     :Rate2Hours!
    t.time     :Rate2Auto!
    t.bigint   :ClinicNum!
    t.time     :Rate3Hours!
    t.time     :Rate3Auto!
    t.integer  :IsWorkingHome!     , 1

    t.index    :ClinicNum, name: "ClinicNum"
    t.index    :EmployeeNum, name: "EmployeeNum"
    t.index    :TimeDisplayed1, name: "TimeDisplayed1"
  end

  create_table :cloudaddress, primary_key: "CloudAddressNum", id: :bigint do |t|
    t.string   :IpAddress!          , 50
    t.bigint   :UserNumLastConnect!
    t.datetime :DateTimeLastConnect!, ["0001-01-01 00:00:00"]

    t.index    :UserNumLastConnect, name: "UserNumLastConnect"
  end

  create_table :codesystem, primary_key: "CodeSystemNum", id: :bigint do |t|
    t.string   :CodeSystemName!
    t.string   :VersionCur!
    t.string   :VersionAvail!
    t.string   :HL7OID!
    t.string   :Note!

    t.index    :CodeSystemName, name: "CodeSystemName"
  end

  create_table  :commlog, primary_key: "CommlogNum", id: :bigint do |t|
    t.bigint    :PatNum!
    t.datetime  :CommDateTime!
    t.bigint    :CommType!
    t.text      :Note
    t.integer   :Mode_!         , 1, [0], unsigned: true
    t.integer   :SentOrReceived!, 1, [0], unsigned: true
    t.bigint    :UserNum!
    t.text      :Signature!
    t.integer   :SigIsTopaz!    , 1
    t.timestamp :DateTStamp!    , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.datetime  :DateTimeEnd!   , ["0001-01-01 00:00:00"]
    t.integer   :CommSource     , 1
    t.bigint    :ProgramNum!
    t.datetime  :DateTEntry!    , ["0001-01-01 00:00:00"]

    t.index     :CommDateTime, name: "CommDateTime"
    t.index     :CommType, name: "CommType"
    t.index    [:PatNum, :CommDateTime, :CommType], name: "indexPNCDateCType"
    t.index     :PatNum, name: "PatNum"
    t.index     :ProgramNum, name: "ProgramNum"
    t.index     :UserNum, name: "UserNum"
  end

  create_table :commoptout, primary_key: "CommOptOutNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.integer  :OptOutSms!
    t.integer  :OptOutEmail!

    t.index    :PatNum, name: "PatNum"
  end

  create_table :computer, primary_key: "ComputerNum", id: :bigint do |t|
    t.string   :CompName      , 100, [""]
    t.datetime :LastHeartBeat!, ["0001-01-01 00:00:00"]
  end

  create_table :computerpref, primary_key: "ComputerPrefNum", id: :bigint do |t|
    t.string   :ComputerName!           , 64
    t.boolean  :GraphicsUseHardware!
    t.boolean  :GraphicsSimple!
    t.string   :SensorType              , ["D"]
    t.integer  :SensorBinned!           , 1
    t.integer  :SensorPort              , [0]
    t.integer  :SensorExposure          , [1]
    t.integer  :GraphicsDoubleBuffering!, 1
    t.integer  :PreferredPixelFormatNum , [0]
    t.string   :AtoZpath
    t.boolean  :TaskKeepListHidden!
    t.integer  :TaskDock!               , [0]
    t.integer  :TaskX!                  , [900]
    t.integer  :TaskY!                  , [625]
    t.string   :DirectXFormat           , [""]
    t.integer  :ScanDocSelectSource!    , 1
    t.integer  :ScanDocShowOptions!     , 1
    t.integer  :ScanDocDuplex!          , 1
    t.integer  :ScanDocGrayscale!       , 1
    t.integer  :ScanDocResolution!
    t.integer  :ScanDocQuality!         , 1, unsigned: true
    t.bigint   :ClinicNum!
    t.bigint   :ApptViewNum!
    t.integer  :RecentApptView!         , 1, unsigned: true
    t.integer  :PatSelectSearchMode!    , 1
    t.integer  :NoShowLanguage!         , 1
    t.integer  :NoShowDecimal!          , 1
    t.string   :ComputerOS!
    t.float    :HelpButtonXAdjustment!  , 53
    t.integer  :GraphicsUseDirectX11!   , 1, [0]
    t.integer  :Zoom!                   , [0]
    t.string   :VideoRectangle!

    t.index    :ApptViewNum, name: "ApptViewNum"
    t.index    :ClinicNum, name: "ClinicNum"
  end

  create_table :confirmationrequest, primary_key: "ConfirmationRequestNum", id: :bigint do |t|
    t.bigint   :ClinicNum!
    t.bigint   :PatNum!
    t.bigint   :ApptNum!
    t.datetime :DateTimeConfirmExpire!  , ["0001-01-01 00:00:00"]
    t.string   :ShortGUID!
    t.string   :ConfirmCode!
    t.datetime :DateTimeEntry!          , ["0001-01-01 00:00:00"]
    t.datetime :DateTimeConfirmTransmit!, ["0001-01-01 00:00:00"]
    t.datetime :DateTimeRSVP!           , ["0001-01-01 00:00:00"]
    t.integer  :RSVPStatus!             , 1
    t.text     :ResponseDescript!
    t.text     :GuidMessageFromMobile!
    t.datetime :ApptDateTime!           , ["0001-01-01 00:00:00"]
    t.bigint   :TSPrior!
    t.integer  :DoNotResend!            , 1
    t.integer  :SendStatus!             , 1
    t.bigint   :ApptReminderRuleNum!
    t.integer  :MessageType!            , 1
    t.bigint   :MessageFk!
    t.datetime :DateTimeSent!           , ["0001-01-01 00:00:00"]

    t.index    :ApptNum, name: "ApptNum"
    t.index    :ApptReminderRuleNum, name: "ApptReminderRuleNum"
    t.index    :ClinicNum, name: "ClinicNum"
    t.index    :MessageFk, name: "MessageFk"
    t.index    :PatNum, name: "PatNum"
    t.index    :TSPrior, name: "TSPrior"
  end

  create_table :connectiongroup, primary_key: "ConnectionGroupNum", id: :bigint do |t|
    t.string   :Description!
  end

  create_table :conngroupattach, primary_key: "ConnGroupAttachNum", id: :bigint do |t|
    t.bigint   :ConnectionGroupNum!
    t.bigint   :CentralConnectionNum!

    t.index    :CentralConnectionNum, name: "CentralConnectionNum"
    t.index    :ConnectionGroupNum, name: "ConnectionGroupNum"
  end

  create_table :contact, primary_key: "ContactNum", id: :bigint do |t|
    t.string   :LName    , [""]
    t.string   :FName    , [""]
    t.string   :WkPhone  , [""]
    t.string   :Fax      , [""]
    t.bigint   :Category!
    t.text     :Notes
  end

  create_table :county, primary_key: "CountyNum", id: :bigint do |t|
    t.string   :CountyName!, [""]
    t.string   :CountyCode , [""]
  end

  create_table :covcat, primary_key: "CovCatNum", id: :bigint do |t|
    t.string   :Description    , 50, [""]
    t.integer  :DefaultPercent!, 2
    t.integer  :CovOrder!
    t.integer  :IsHidden!      , 1, [0], unsigned: true
    t.integer  :EbenefitCat!   , 1, [0], unsigned: true
  end

  create_table :covspan, primary_key: "CovSpanNum", id: :bigint do |t|
    t.bigint   :CovCatNum!
    t.string   :FromCode  , 15, [""], collation: "utf8mb3_bin"
    t.string   :ToCode    , 15, [""], collation: "utf8mb3_bin"

    t.index    :CovCatNum, name: "CovCatNum"
  end

  create_table :cpt, primary_key: "CptNum", id: :bigint do |t|
    t.string   :CptCode!
    t.string   :Description!, 4000
    t.string   :VersionIDs!

    t.index    :CptCode, name: "CptCode"
  end

  create_table :creditcard, primary_key: "CreditCardNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.string   :Address
    t.string   :Zip
    t.string   :XChargeToken
    t.string   :CCNumberMasked
    t.date     :CCExpiration!      , ["0001-01-01"]
    t.integer  :ItemOrder!
    t.float    :ChargeAmt!         , 53
    t.date     :DateStart!         , ["0001-01-01"]
    t.date     :DateStop!          , ["0001-01-01"]
    t.string   :Note!
    t.bigint   :PayPlanNum!
    t.string   :PayConnectToken!
    t.date     :PayConnectTokenExp!, ["0001-01-01"]
    t.text     :Procedures!
    t.integer  :CCSource!          , 1
    t.bigint   :ClinicNum!
    t.integer  :ExcludeProcSync!   , 1
    t.string   :PaySimpleToken!
    t.string   :ChargeFrequency!   , 150
    t.integer  :CanChargeWhenNoBal!, 1
    t.bigint   :PaymentType!
    t.integer  :IsRecurringActive! , 1

    t.index    :ClinicNum, name: "ClinicNum"
    t.index    :PatNum, name: "PatNum"
    t.index    :PayPlanNum, name: "PayPlanNum"
    t.index    :PaymentType, name: "PaymentType"
  end

  create_table :custrefentry, primary_key: "CustRefEntryNum", id: :bigint do |t|
    t.bigint   :PatNumCust!
    t.bigint   :PatNumRef!
    t.date     :DateEntry! , ["0001-01-01"]
    t.string   :Note!

    t.index    :PatNumCust, name: "PatNumCust"
    t.index    :PatNumRef, name: "PatNumRef"
  end

  create_table :custreference, primary_key: "CustReferenceNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.date     :DateMostRecent!, ["0001-01-01"]
    t.string   :Note!
    t.integer  :IsBadRef!      , 1

    t.index    :PatNum, name: "PatNum"
  end

  create_table :cvx, primary_key: "CvxNum", id: :bigint do |t|
    t.string   :CvxCode!
    t.string   :Description!
    t.string   :IsActive!

    t.index    :CvxCode, name: "CvxCode"
  end

  create_table :dashboardar, primary_key: "DashboardARNum", id: :bigint do |t|
    t.date     :DateCalc!, ["0001-01-01"]
    t.float    :BalTotal!, 53
    t.float    :InsEst!  , 53
  end

  create_table :dashboardcell, primary_key: "DashboardCellNum", id: :bigint do |t|
    t.bigint   :DashboardLayoutNum!
    t.integer  :CellRow!
    t.integer  :CellColumn!
    t.string   :CellType!
    t.text     :CellSettings!
    t.datetime :LastQueryTime!     , ["0001-01-01 00:00:00"]
    t.text     :LastQueryData!
    t.integer  :RefreshRateSeconds!

    t.index    :DashboardLayoutNum, name: "DashboardLayoutNum"
  end

  create_table :dashboardlayout, primary_key: "DashboardLayoutNum", id: :bigint do |t|
    t.bigint   :UserNum!
    t.bigint   :UserGroupNum!
    t.string   :DashboardTabName!
    t.integer  :DashboardTabOrder!
    t.integer  :DashboardRows!
    t.integer  :DashboardColumns!
    t.string   :DashboardGroupName!

    t.index    :UserGroupNum, name: "UserGroupNum"
    t.index    :UserNum, name: "UserNum"
  end

  create_table :databasemaintenance, primary_key: "DatabaseMaintenanceNum", id: :bigint do |t|
    t.string   :MethodName!
    t.integer  :IsHidden!   , 1
    t.integer  :IsOld!      , 1
    t.datetime :DateLastRun!, ["0001-01-01 00:00:00"]
  end

  create_table :dbmlog, primary_key: "DbmLogNum", id: :bigint do |t|
    t.bigint   :UserNum!
    t.bigint   :FKey!
    t.integer  :FKeyType!     , 1
    t.integer  :ActionType!   , 1
    t.datetime :DateTimeEntry!, ["0001-01-01 00:00:00"]
    t.string   :MethodName!
    t.text     :LogText!

    t.index    :DateTimeEntry, name: "DateTimeEntry"
    t.index   [:FKey, :FKeyType], name: "FKeyAndType"
    t.index    :MethodName, name: "MethodName"
    t.index    :UserNum, name: "UserNum"
  end

  create_table :definition, primary_key: "DefNum", id: :bigint do |t|
    t.integer  :Category! , 1, [0], unsigned: true
    t.integer  :ItemOrder!, 2, [0], unsigned: true
    t.string   :ItemName  , [""]
    t.string   :ItemValue , [""]
    t.integer  :ItemColor!, [0]
    t.integer  :IsHidden! , 1, [0], unsigned: true
  end

  create_table :deflink, primary_key: "DefLinkNum", id: :bigint do |t|
    t.bigint   :DefNum!
    t.bigint   :FKey!
    t.integer  :LinkType!, 1

    t.index    :DefNum, name: "DefNum"
    t.index    :FKey, name: "FKey"
  end

  create_table  :deletedobject, primary_key: "DeletedObjectNum", id: :bigint do |t|
    t.bigint    :ObjectNum!
    t.integer   :ObjectType!
    t.timestamp :DateTStamp!, [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
  end

  create_table :deposit, primary_key: "DepositNum", id: :bigint do |t|
    t.date     :DateDeposit!             , ["0001-01-01"]
    t.text     :BankAccountInfo
    t.float    :Amount!                  , 53, [0.0]
    t.string   :Memo!
    t.string   :Batch!                   , 25
    t.bigint   :DepositAccountNum!
    t.integer  :IsSentToQuickBooksOnline!, 1

    t.index    :DepositAccountNum, name: "DepositAccountNum"
  end

  create_table :dictcustom, primary_key: "DictCustomNum", id: :bigint do |t|
    t.string   :WordText!
  end

  create_table :discountplan, primary_key: "DiscountPlanNum", id: :bigint do |t|
    t.string   :Description!
    t.bigint   :FeeSchedNum!
    t.bigint   :DefNum!
    t.integer  :IsHidden!            , 1
    t.text     :PlanNote!
    t.integer  :ExamFreqLimit!
    t.integer  :XrayFreqLimit!
    t.integer  :ProphyFreqLimit!
    t.integer  :FluorideFreqLimit!
    t.integer  :PerioFreqLimit!
    t.integer  :LimitedExamFreqLimit!
    t.integer  :PAFreqLimit!
    t.float    :AnnualMax!           , 53, [-1.0]

    t.index    :DefNum, name: "DefNum"
    t.index    :FeeSchedNum, name: "FeeSchedNum"
  end

  create_table :discountplansub, primary_key: "DiscountSubNum", id: :bigint do |t|
    t.bigint   :DiscountPlanNum!
    t.bigint   :PatNum!
    t.date     :DateEffective!  , ["0001-01-01"]
    t.date     :DateTerm!       , ["0001-01-01"]
    t.text     :SubNote!

    t.index    :DiscountPlanNum, name: "DiscountPlanNum"
    t.index    :PatNum, name: "PatNum"
  end

  create_table  :disease, primary_key: "DiseaseNum", id: :bigint do |t|
    t.bigint    :PatNum!
    t.bigint    :DiseaseDefNum!
    t.text      :PatNote
    t.timestamp :DateTStamp!       , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.integer   :ProbStatus!       , 1
    t.date      :DateStart!        , ["0001-01-01"]
    t.date      :DateStop!         , ["0001-01-01"]
    t.string    :SnomedProblemType!
    t.integer   :FunctionStatus!   , 1

    t.index     :DiseaseDefNum, name: "DiseaseDefNum"
    t.index     :PatNum, name: "indexPatNum"
  end

  create_table  :diseasedef, primary_key: "DiseaseDefNum", id: :bigint do |t|
    t.string    :DiseaseName, [""]
    t.integer   :ItemOrder! , 2, unsigned: true
    t.integer   :IsHidden!  , 1, unsigned: true
    t.timestamp :DateTStamp!, [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.string    :ICD9Code!
    t.string    :SnomedCode!
    t.string    :Icd10Code!

    t.index     :ICD9Code, name: "ICD9Code"
    t.index     :Icd10Code, name: "Icd10Code"
    t.index     :SnomedCode, name: "SnomedCode"
  end

  create_table :displayfield, primary_key: "DisplayFieldNum", id: :bigint do |t|
    t.string   :InternalName
    t.integer  :ItemOrder!
    t.string   :Description
    t.integer  :ColumnWidth!
    t.integer  :Category!           , [0]
    t.bigint   :ChartViewNum!
    t.text     :PickList!
    t.string   :DescriptionOverride!

    t.index    :ChartViewNum, name: "ChartViewNum"
  end

  create_table :displayreport, primary_key: "DisplayReportNum", id: :bigint do |t|
    t.string   :InternalName!
    t.integer  :ItemOrder!
    t.string   :Description!
    t.integer  :Category!          , 1
    t.integer  :IsHidden!          , 1
    t.integer  :IsVisibleInSubMenu!, 1
  end

  create_table :dispsupply, primary_key: "DispSupplyNum", id: :bigint do |t|
    t.bigint   :SupplyNum!
    t.bigint   :ProvNum!
    t.date     :DateDispensed!, ["0001-01-01"]
    t.float    :DispQuantity!
    t.text     :Note!

    t.index    :ProvNum, name: "ProvNum"
    t.index    :SupplyNum, name: "SupplyNum"
  end

  create_table  :document, primary_key: "DocNum", id: :bigint do |t|
    t.string    :Description    , [""]
    t.datetime  :DateCreated!
    t.bigint    :DocCategory!
    t.bigint    :PatNum!
    t.string    :FileName       , [""]
    t.integer   :ImgType!       , 1, [0], unsigned: true
    t.integer   :IsFlipped!     , 1, [0], unsigned: true
    t.float     :DegreesRotated!
    t.string    :ToothNumbers   , [""]
    t.text      :Note!          , size: :medium
    t.integer   :SigIsTopaz!    , 1, unsigned: true
    t.text      :Signature
    t.integer   :CropX!
    t.integer   :CropY!
    t.integer   :CropW!
    t.integer   :CropH!
    t.integer   :WindowingMin!
    t.integer   :WindowingMax!
    t.bigint    :MountItemNum!
    t.timestamp :DateTStamp!    , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.text      :RawBase64!     , size: :medium
    t.text      :Thumbnail!
    t.string    :ExternalGUID!
    t.string    :ExternalSource!
    t.bigint    :ProvNum!
    t.integer   :IsCropOld!     , 1, unsigned: true

    t.index     :MountItemNum, name: "MountItemNum"
    t.index    [:PatNum, :DocCategory], name: "PNDC"
    t.index     :PatNum, name: "PatNum"
  end

  create_table :documentmisc, primary_key: "DocMiscNum", id: :bigint do |t|
    t.date     :DateCreated!, ["0001-01-01"]
    t.string   :FileName!
    t.integer  :DocMiscType!, 1
    t.text     :RawBase64!  , size: :long
  end

  create_table :drugmanufacturer, primary_key: "DrugManufacturerNum", id: :bigint do |t|
    t.string   :ManufacturerName!
    t.string   :ManufacturerCode!, 20
  end

  create_table :drugunit, primary_key: "DrugUnitNum", id: :bigint do |t|
    t.string   :UnitIdentifier!, 20
    t.string   :UnitText!
  end

  create_table :dunning, primary_key: "DunningNum", id: :bigint do |t|
    t.text     :DunMessage
    t.bigint   :BillingType!
    t.integer  :AgeAccount!   , 1, [0], unsigned: true
    t.integer  :InsIsPending! , 1, [0], unsigned: true
    t.text     :MessageBold
    t.string   :EmailSubject!
    t.text     :EmailBody!    , size: :medium
    t.integer  :DaysInAdvance!
    t.bigint   :ClinicNum!
    t.integer  :IsSuperFamily!, 1

    t.index    :ClinicNum, name: "ClinicNum"
  end

  create_table :ebill, primary_key: "EbillNum", id: :bigint do |t|
    t.bigint   :ClinicNum!
    t.string   :ClientAcctNumber!
    t.string   :ElectUserName!
    t.string   :ElectPassword!
    t.integer  :PracticeAddress! , 1
    t.integer  :RemitAddress!    , 1

    t.index    :ClinicNum, name: "ClinicNum"
  end

  create_table :eclipboardimagecapture, primary_key: "EClipboardImageCaptureNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.bigint   :DefNum!
    t.integer  :IsSelfPortrait!  , 1
    t.datetime :DateTimeUpserted!, ["0001-01-01 00:00:00"]
    t.bigint   :DocNum!

    t.index    :DefNum, name: "DefNum"
    t.index    :DocNum, name: "DocNum"
    t.index    :PatNum, name: "PatNum"
  end

  create_table :eclipboardimagecapturedef, primary_key: "EClipboardImageCaptureDefNum", id: :bigint do |t|
    t.bigint   :DefNum!
    t.integer  :IsSelfPortrait!, 1
    t.integer  :FrequencyDays!
    t.bigint   :ClinicNum!

    t.index    :ClinicNum, name: "ClinicNum"
    t.index    :DefNum, name: "DefNum"
  end

  create_table :eclipboardsheetdef, primary_key: "EClipboardSheetDefNum", id: :bigint do |t|
    t.bigint   :SheetDefNum!
    t.bigint   :ClinicNum!
    t.bigint   :ResubmitInterval!
    t.integer  :ItemOrder!
    t.integer  :PrefillStatus!        , 1
    t.integer  :MinAge!               , [-1]
    t.integer  :MaxAge!               , [-1]
    t.text     :IgnoreSheetDefNums!
    t.bigint   :PrefillStatusOverride!

    t.index    :ClinicNum, name: "ClinicNum"
    t.index    :PrefillStatusOverride, name: "PrefillStatusOverride"
    t.index    :ResubmitInterval, name: "ResubmitInterval"
    t.index    :SheetDefNum, name: "SheetDefNum"
  end

  create_table :eduresource, primary_key: "EduResourceNum", id: :bigint do |t|
    t.bigint   :DiseaseDefNum!
    t.bigint   :MedicationNum!
    t.string   :LabResultID!
    t.string   :LabResultName!
    t.string   :LabResultCompare!
    t.string   :ResourceUrl!
    t.string   :SmokingSnoMed!

    t.index    :DiseaseDefNum, name: "DiseaseDefNum"
    t.index    :LabResultID, name: "LabResultID"
    t.index    :MedicationNum, name: "MedicationNum"
  end

  create_table :ehramendment, primary_key: "EhrAmendmentNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.integer  :IsAccepted!     , 1
    t.text     :Description!
    t.integer  :Source!         , 1
    t.text     :SourceName!
    t.string   :FileName!
    t.text     :RawBase64!      , size: :long
    t.datetime :DateTRequest!   , ["0001-01-01 00:00:00"]
    t.datetime :DateTAcceptDeny!, ["0001-01-01 00:00:00"]
    t.datetime :DateTAppend!    , ["0001-01-01 00:00:00"]

    t.index    :PatNum, name: "PatNum"
  end

  create_table :ehraptobs, primary_key: "EhrAptObsNum", id: :bigint do |t|
    t.bigint   :AptNum!
    t.integer  :IdentifyingCode!, 1
    t.integer  :ValType!        , 1
    t.string   :ValReported!
    t.string   :UcumCode!
    t.string   :ValCodeSystem!

    t.index    :AptNum, name: "AptNum"
  end

  create_table :ehrcareplan, primary_key: "EhrCarePlanNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.string   :SnomedEducation!
    t.string   :Instructions!
    t.date     :DatePlanned!    , ["0001-01-01"]

    t.index    :PatNum, name: "PatNum"
  end

  create_table :ehrlab, primary_key: "EhrLabNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.string   :OrderControlCode!
    t.string   :PlacerOrderNum!
    t.string   :PlacerOrderNamespace!
    t.string   :PlacerOrderUniversalID!
    t.string   :PlacerOrderUniversalIDType!
    t.string   :FillerOrderNum!
    t.string   :FillerOrderNamespace!
    t.string   :FillerOrderUniversalID!
    t.string   :FillerOrderUniversalIDType!
    t.string   :PlacerGroupNum!
    t.string   :PlacerGroupNamespace!
    t.string   :PlacerGroupUniversalID!
    t.string   :PlacerGroupUniversalIDType!
    t.string   :OrderingProviderID!
    t.string   :OrderingProviderLName!
    t.string   :OrderingProviderFName!
    t.string   :OrderingProviderMiddleNames!
    t.string   :OrderingProviderSuffix!
    t.string   :OrderingProviderPrefix!
    t.string   :OrderingProviderAssigningAuthorityNamespaceID!
    t.string   :OrderingProviderAssigningAuthorityUniversalID!
    t.string   :OrderingProviderAssigningAuthorityIDType!
    t.string   :OrderingProviderNameTypeCode!
    t.string   :OrderingProviderIdentifierTypeCode!
    t.bigint   :SetIdOBR!
    t.string   :UsiID!
    t.string   :UsiText!
    t.string   :UsiCodeSystemName!
    t.string   :UsiIDAlt!
    t.string   :UsiTextAlt!
    t.string   :UsiCodeSystemNameAlt!
    t.string   :UsiTextOriginal!
    t.string   :ObservationDateTimeStart!
    t.string   :ObservationDateTimeEnd!
    t.string   :SpecimenActionCode!
    t.string   :ResultDateTime!
    t.string   :ResultStatus!
    t.string   :ParentObservationID!
    t.string   :ParentObservationText!
    t.string   :ParentObservationCodeSystemName!
    t.string   :ParentObservationIDAlt!
    t.string   :ParentObservationTextAlt!
    t.string   :ParentObservationCodeSystemNameAlt!
    t.string   :ParentObservationTextOriginal!
    t.string   :ParentObservationSubID!
    t.string   :ParentPlacerOrderNum!
    t.string   :ParentPlacerOrderNamespace!
    t.string   :ParentPlacerOrderUniversalID!
    t.string   :ParentPlacerOrderUniversalIDType!
    t.string   :ParentFillerOrderNum!
    t.string   :ParentFillerOrderNamespace!
    t.string   :ParentFillerOrderUniversalID!
    t.string   :ParentFillerOrderUniversalIDType!
    t.integer  :ListEhrLabResultsHandlingF!                   , 1
    t.integer  :ListEhrLabResultsHandlingN!                   , 1
    t.bigint   :TQ1SetId!
    t.string   :TQ1DateTimeStart!
    t.string   :TQ1DateTimeEnd!
    t.integer  :IsCpoe!                                       , 1
    t.text     :OriginalPIDSegment!

    t.index    :PatNum, name: "PatNum"
    t.index    :SetIdOBR, name: "SetIdOBR"
    t.index    :TQ1SetId, name: "TQ1SetId"
  end

  create_table :ehrlabclinicalinfo, primary_key: "EhrLabClinicalInfoNum", id: :bigint do |t|
    t.bigint   :EhrLabNum!
    t.string   :ClinicalInfoID!
    t.string   :ClinicalInfoText!
    t.string   :ClinicalInfoCodeSystemName!
    t.string   :ClinicalInfoIDAlt!
    t.string   :ClinicalInfoTextAlt!
    t.string   :ClinicalInfoCodeSystemNameAlt!
    t.string   :ClinicalInfoTextOriginal!

    t.index    :EhrLabNum, name: "EhrLabNum"
  end

  create_table :ehrlabimage, primary_key: "EhrLabImageNum", id: :bigint do |t|
    t.bigint   :EhrLabNum!
    t.bigint   :DocNum!

    t.index    :DocNum, name: "DocNum"
    t.index    :EhrLabNum, name: "EhrLabNum"
  end

  create_table :ehrlabnote, primary_key: "EhrLabNoteNum", id: :bigint do |t|
    t.bigint   :EhrLabNum!
    t.bigint   :EhrLabResultNum!
    t.text     :Comments!

    t.index    :EhrLabNum, name: "EhrLabNum"
    t.index    :EhrLabResultNum, name: "EhrLabResultNum"
  end

  create_table :ehrlabresult, primary_key: "EhrLabResultNum", id: :bigint do |t|
    t.bigint   :EhrLabNum!
    t.bigint   :SetIdOBX!
    t.string   :ValueType!
    t.string   :ObservationIdentifierID!
    t.string   :ObservationIdentifierText!
    t.string   :ObservationIdentifierCodeSystemName!
    t.string   :ObservationIdentifierIDAlt!
    t.string   :ObservationIdentifierTextAlt!
    t.string   :ObservationIdentifierCodeSystemNameAlt!
    t.string   :ObservationIdentifierTextOriginal!
    t.string   :ObservationIdentifierSub!
    t.string   :ObservationValueCodedElementID!
    t.string   :ObservationValueCodedElementText!
    t.string   :ObservationValueCodedElementCodeSystemName!
    t.string   :ObservationValueCodedElementIDAlt!
    t.string   :ObservationValueCodedElementTextAlt!
    t.string   :ObservationValueCodedElementCodeSystemNameAlt!
    t.string   :ObservationValueCodedElementTextOriginal!
    t.string   :ObservationValueDateTime!
    t.time     :ObservationValueTime!                                       , ["2000-01-01 00:00:00"]
    t.string   :ObservationValueComparator!
    t.float    :ObservationValueNumber1!                                    , 53
    t.string   :ObservationValueSeparatorOrSuffix!
    t.float    :ObservationValueNumber2!                                    , 53
    t.float    :ObservationValueNumeric!                                    , 53
    t.string   :ObservationValueText!
    t.string   :UnitsID!
    t.string   :UnitsText!
    t.string   :UnitsCodeSystemName!
    t.string   :UnitsIDAlt!
    t.string   :UnitsTextAlt!
    t.string   :UnitsCodeSystemNameAlt!
    t.string   :UnitsTextOriginal!
    t.string   :referenceRange!
    t.string   :AbnormalFlags!
    t.string   :ObservationResultStatus!
    t.string   :ObservationDateTime!
    t.string   :AnalysisDateTime!
    t.string   :PerformingOrganizationName!
    t.string   :PerformingOrganizationNameAssigningAuthorityNamespaceId!
    t.string   :PerformingOrganizationNameAssigningAuthorityUniversalId!
    t.string   :PerformingOrganizationNameAssigningAuthorityUniversalIdType!
    t.string   :PerformingOrganizationIdentifierTypeCode!
    t.string   :PerformingOrganizationIdentifier!
    t.string   :PerformingOrganizationAddressStreet!
    t.string   :PerformingOrganizationAddressOtherDesignation!
    t.string   :PerformingOrganizationAddressCity!
    t.string   :PerformingOrganizationAddressStateOrProvince!
    t.string   :PerformingOrganizationAddressZipOrPostalCode!
    t.string   :PerformingOrganizationAddressCountryCode!
    t.string   :PerformingOrganizationAddressAddressType!
    t.string   :PerformingOrganizationAddressCountyOrParishCode!
    t.string   :MedicalDirectorID!
    t.string   :MedicalDirectorLName!
    t.string   :MedicalDirectorFName!
    t.string   :MedicalDirectorMiddleNames!
    t.string   :MedicalDirectorSuffix!
    t.string   :MedicalDirectorPrefix!
    t.string   :MedicalDirectorAssigningAuthorityNamespaceID!
    t.string   :MedicalDirectorAssigningAuthorityUniversalID!
    t.string   :MedicalDirectorAssigningAuthorityIDType!
    t.string   :MedicalDirectorNameTypeCode!
    t.string   :MedicalDirectorIdentifierTypeCode!

    t.index    :EhrLabNum, name: "EhrLabNum"
    t.index    :SetIdOBX, name: "SetIdOBX"
  end

  create_table :ehrlabresultscopyto, primary_key: "EhrLabResultsCopyToNum", id: :bigint do |t|
    t.bigint   :EhrLabNum!
    t.string   :CopyToID!
    t.string   :CopyToLName!
    t.string   :CopyToFName!
    t.string   :CopyToMiddleNames!
    t.string   :CopyToSuffix!
    t.string   :CopyToPrefix!
    t.string   :CopyToAssigningAuthorityNamespaceID!
    t.string   :CopyToAssigningAuthorityUniversalID!
    t.string   :CopyToAssigningAuthorityIDType!
    t.string   :CopyToNameTypeCode!
    t.string   :CopyToIdentifierTypeCode!

    t.index    :EhrLabNum, name: "EhrLabNum"
  end

  create_table :ehrlabspecimen, primary_key: "EhrLabSpecimenNum", id: :bigint do |t|
    t.bigint   :EhrLabNum!
    t.bigint   :SetIdSPM!
    t.string   :SpecimenTypeID!
    t.string   :SpecimenTypeText!
    t.string   :SpecimenTypeCodeSystemName!
    t.string   :SpecimenTypeIDAlt!
    t.string   :SpecimenTypeTextAlt!
    t.string   :SpecimenTypeCodeSystemNameAlt!
    t.string   :SpecimenTypeTextOriginal!
    t.string   :CollectionDateTimeStart!
    t.string   :CollectionDateTimeEnd!

    t.index    :EhrLabNum, name: "EhrLabNum"
    t.index    :SetIdSPM, name: "SetIdSPM"
  end

  create_table :ehrlabspecimencondition, primary_key: "EhrLabSpecimenConditionNum", id: :bigint do |t|
    t.bigint   :EhrLabSpecimenNum!
    t.string   :SpecimenConditionID!
    t.string   :SpecimenConditionText!
    t.string   :SpecimenConditionCodeSystemName!
    t.string   :SpecimenConditionIDAlt!
    t.string   :SpecimenConditionTextAlt!
    t.string   :SpecimenConditionCodeSystemNameAlt!
    t.string   :SpecimenConditionTextOriginal!

    t.index    :EhrLabSpecimenNum, name: "EhrLabSpecimenNum"
  end

  create_table :ehrlabspecimenrejectreason, primary_key: "EhrLabSpecimenRejectReasonNum", id: :bigint do |t|
    t.bigint   :EhrLabSpecimenNum!
    t.string   :SpecimenRejectReasonID!
    t.string   :SpecimenRejectReasonText!
    t.string   :SpecimenRejectReasonCodeSystemName!
    t.string   :SpecimenRejectReasonIDAlt!
    t.string   :SpecimenRejectReasonTextAlt!
    t.string   :SpecimenRejectReasonCodeSystemNameAlt!
    t.string   :SpecimenRejectReasonTextOriginal!

    t.index    :EhrLabSpecimenNum, name: "EhrLabSpecimenNum"
  end

  create_table :ehrmeasure, primary_key: "EhrMeasureNum", id: :bigint do |t|
    t.integer  :MeasureType!, 1
    t.integer  :Numerator!  , 2
    t.integer  :Denominator!, 2
  end

  create_table :ehrmeasureevent, primary_key: "EhrMeasureEventNum", id: :bigint do |t|
    t.datetime :DateTEvent!            , ["0001-01-01 00:00:00"]
    t.integer  :EventType!             , 1
    t.bigint   :PatNum!
    t.string   :MoreInfo!
    t.string   :CodeValueEvent!        , 30
    t.string   :CodeSystemEvent!       , 30
    t.string   :CodeValueResult!       , 30
    t.string   :CodeSystemResult!      , 30
    t.bigint   :FKey!
    t.integer  :TobaccoCessationDesire!, 1, unsigned: true
    t.date     :DateStartTobacco!      , ["0001-01-01"]

    t.index    :CodeValueEvent, name: "CodeValueEvent"
    t.index    :CodeValueResult, name: "CodeValueResult"
    t.index    :FKey, name: "FKey"
    t.index    :PatNum, name: "PatNum"
  end

  create_table :ehrnotperformed, primary_key: "EhrNotPerformedNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.bigint   :ProvNum!
    t.string   :CodeValue!       , 30
    t.string   :CodeSystem!      , 30
    t.string   :CodeValueReason! , 30
    t.string   :CodeSystemReason!, 30
    t.text     :Note!
    t.date     :DateEntry!       , ["0001-01-01"]

    t.index    :CodeValue, name: "CodeValue"
    t.index    :CodeValueReason, name: "CodeValueReason"
    t.index    :PatNum, name: "PatNum"
    t.index    :ProvNum, name: "ProvNum"
  end

  create_table :ehrpatient, primary_key: "PatNum", id: :bigint, default: 0 do |t|
    t.string   :MotherMaidenFname!
    t.string   :MotherMaidenLname!
    t.integer  :VacShareOk!           , 1
    t.string   :MedicaidState!        , 50
    t.string   :SexualOrientation!
    t.string   :GenderIdentity!
    t.string   :SexualOrientationNote!
    t.string   :GenderIdentityNote!
  end

  create_table :ehrprovkey, primary_key: "EhrProvKeyNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.string   :LName!
    t.string   :FName!
    t.string   :ProvKey!
    t.float    :FullTimeEquiv!
    t.text     :Notes!
    t.integer  :YearValue!

    t.index    :PatNum, name: "PatNum"
  end

  create_table :ehrquarterlykey, primary_key: "EhrQuarterlyKeyNum", id: :bigint do |t|
    t.integer  :YearValue!
    t.integer  :QuarterValue!
    t.string   :PracticeName!
    t.string   :KeyValue!
    t.bigint   :PatNum!
    t.text     :Notes!

    t.index    :PatNum, name: "PatNum"
  end

  create_table :ehrsummaryccd, primary_key: "EhrSummaryCcdNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.date     :DateSummary!   , ["0001-01-01"]
    t.text     :ContentSummary!, size: :long
    t.bigint   :EmailAttachNum!

    t.index    :EmailAttachNum, name: "EmailAttachNum"
    t.index    :PatNum, name: "PatNum"
  end

  create_table :ehrtrigger, primary_key: "EhrTriggerNum", id: :bigint do |t|
    t.string   :Description!
    t.text     :ProblemSnomedList!
    t.text     :ProblemIcd9List!
    t.text     :ProblemIcd10List!
    t.text     :ProblemDefNumList!
    t.text     :MedicationNumList!
    t.text     :RxCuiList!
    t.text     :CvxList!
    t.text     :AllergyDefNumList!
    t.text     :DemographicsList!
    t.text     :LabLoincList!
    t.text     :VitalLoincList!
    t.text     :Instructions!
    t.text     :Bibliography!
    t.integer  :Cardinality!      , 1
  end

  create_table :electid, primary_key: "ElectIDNum", id: :bigint do |t|
    t.string   :PayorID      , [""]
    t.string   :CarrierName  , [""]
    t.integer  :IsMedicaid!  , 1, [0], unsigned: true
    t.string   :ProviderTypes, [""]
    t.text     :Comments
  end

  create_table :emailaddress, primary_key: "EmailAddressNum", id: :bigint do |t|
    t.string   :SMTPserver!
    t.string   :EmailUsername!
    t.string   :EmailPassword!
    t.integer  :ServerPort!
    t.integer  :UseSSL!            , 1
    t.string   :SenderAddress!
    t.string   :Pop3ServerIncoming!
    t.integer  :ServerPortIncoming!
    t.bigint   :UserNum!
    t.string   :AccessToken!       , 2000
    t.text     :RefreshToken!
    t.integer  :DownloadInbox!     , 1
    t.string   :QueryString!       , 1000
    t.integer  :AuthenticationType!, 1

    t.index    :UserNum, name: "UserNum"
  end

  create_table :emailattach, primary_key: "EmailAttachNum", id: :bigint do |t|
    t.bigint   :EmailMessageNum!
    t.string   :DisplayedFileName, [""]
    t.string   :ActualFileName   , [""]
    t.bigint   :EmailTemplateNum!

    t.index    :EmailMessageNum, name: "EmailMessageNum"
    t.index    :EmailTemplateNum, name: "EmailTemplateNum"
  end

  create_table :emailautograph, primary_key: "EmailAutographNum", id: :bigint do |t|
    t.text     :Description!
    t.string   :EmailAddress!
    t.text     :AutographText!
  end

  create_table :emailhostingtemplate, primary_key: "EmailHostingTemplateNum", id: :bigint do |t|
    t.string   :TemplateName!
    t.text     :Subject!
    t.text     :BodyPlainText!    , size: :medium
    t.text     :BodyHTML!         , size: :medium
    t.bigint   :TemplateId!
    t.bigint   :ClinicNum!
    t.string   :EmailTemplateType!
    t.string   :TemplateType!

    t.index    :ClinicNum, name: "ClinicNum"
    t.index    :TemplateId, name: "TemplateId"
  end

  create_table  :emailmessage, primary_key: "EmailMessageNum", id: :bigint do |t|
    t.bigint    :PatNum!
    t.text      :ToAddress
    t.text      :FromAddress
    t.text      :Subject
    t.text      :BodyText!        , size: :long
    t.datetime  :MsgDateTime!
    t.integer   :SentOrReceived!  , 1, unsigned: true
    t.string    :RecipientAddress!
    t.text      :RawEmailIn!      , size: :long
    t.bigint    :ProvNumWebMail!
    t.bigint    :PatNumSubj!
    t.text      :CcAddress!
    t.text      :BccAddress!
    t.integer   :HideIn!          , 1
    t.bigint    :AptNum!
    t.bigint    :UserNum!
    t.integer   :HtmlType!        , 1
    t.datetime  :SecDateTEntry!   , ["0001-01-01 00:00:00"]
    t.timestamp :SecDateTEdit!    , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.string    :MsgType!
    t.string    :FailReason!

    t.index     :AptNum, name: "AptNum"
    t.index    [:MsgDateTime, :SentOrReceived], name: "MsgBoxCompound"
    t.index     :PatNum, name: "PatNum"
    t.index     :PatNumSubj, name: "PatNumSubj"
    t.index     :ProvNumWebMail, name: "ProvNumWebMail"
    t.index     :SecDateTEdit, name: "SecDateTEdit"
    t.index     :SecDateTEntry, name: "SecDateTEntry"
    t.index    [:SentOrReceived, :RecipientAddress, :FromAddress], name: "MsgHistoricAddresses", length: { RecipientAddress: 50, FromAddress: 50 }
    t.index     :SentOrReceived, name: "SentOrReceived"
    t.index     :UserNum, name: "UserNum"
  end

  create_table :emailmessageuid, primary_key: "EmailMessageUidNum", id: :bigint do |t|
    t.text     :MsgId
    t.string   :RecipientAddress!
  end

  create_table  :emailsecure, primary_key: "EmailSecureNum", id: :bigint do |t|
    t.bigint    :ClinicNum!
    t.bigint    :PatNum!
    t.bigint    :EmailMessageNum!
    t.bigint    :EmailChainFK!
    t.bigint    :EmailFK!
    t.datetime  :DateTEntry!     , ["0001-01-01 00:00:00"]
    t.timestamp :SecDateTEdit!   , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]

    t.index     :ClinicNum, name: "ClinicNum"
    t.index     :EmailChainFK, name: "EmailChainFK"
    t.index     :EmailFK, name: "EmailFK"
    t.index     :EmailMessageNum, name: "EmailMessageNum"
    t.index     :PatNum, name: "PatNum"
  end

  create_table  :emailsecureattach, primary_key: "EmailSecureAttachNum", id: :bigint do |t|
    t.bigint    :ClinicNum!
    t.bigint    :EmailAttachNum!
    t.bigint    :EmailSecureNum!
    t.string    :AttachmentGuid!   , 50
    t.string    :DisplayedFileName!
    t.string    :Extension!
    t.datetime  :DateTEntry!       , ["0001-01-01 00:00:00"]
    t.timestamp :SecDateTEdit!     , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]

    t.index     :ClinicNum, name: "ClinicNum"
    t.index     :EmailAttachNum, name: "EmailAttachNum"
    t.index     :EmailSecureNum, name: "EmailSecureNum"
  end

  create_table :emailtemplate, primary_key: "EmailTemplateNum", id: :bigint do |t|
    t.text     :Subject
    t.text     :BodyText
    t.text     :Description!
    t.integer  :TemplateType!, 1
  end

  create_table :employee, primary_key: "EmployeeNum", id: :bigint do |t|
    t.string   :LName         , [""]
    t.string   :FName         , [""]
    t.string   :MiddleI       , [""]
    t.integer  :IsHidden!     , 1, [0], unsigned: true
    t.string   :ClockStatus   , [""]
    t.integer  :PhoneExt!
    t.string   :PayrollID!
    t.string   :WirelessPhone!
    t.string   :EmailWork!
    t.string   :EmailPersonal!
    t.integer  :IsFurloughed! , 1
    t.integer  :IsWorkingHome!, 1
    t.bigint   :ReportsTo!
  end

  create_table :employer, primary_key: "EmployerNum", id: :bigint do |t|
    t.string   :EmpName , [""]
    t.string   :Address , [""]
    t.string   :Address2, [""]
    t.string   :City    , [""]
    t.string   :State   , [""]
    t.string   :Zip     , [""]
    t.string   :Phone   , [""]
  end

  create_table :encounter, primary_key: "EncounterNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.bigint   :ProvNum!
    t.string   :CodeValue!    , 30
    t.string   :CodeSystem!   , 30
    t.text     :Note!
    t.date     :DateEncounter!, ["0001-01-01"]

    t.index    :CodeValue, name: "CodeValue"
    t.index    :PatNum, name: "PatNum"
    t.index    :ProvNum, name: "ProvNum"
  end

  create_table :entrylog, primary_key: "EntryLogNum", id: :bigint do |t|
    t.bigint   :UserNum!
    t.integer  :FKeyType!     , 1
    t.bigint   :FKey!
    t.integer  :LogSource!    , 1
    t.datetime :EntryDateTime!, ["0001-01-01 00:00:00"]

    t.index    :EntryDateTime, name: "EntryDateTime"
    t.index    :FKey, name: "FKey"
    t.index    :UserNum, name: "UserNum"
  end

  create_table :eobattach, primary_key: "EobAttachNum", id: :bigint do |t|
    t.bigint   :ClaimPaymentNum!
    t.datetime :DateTCreated!
    t.string   :FileName!
    t.text     :RawBase64!

    t.index    :ClaimPaymentNum, name: "ClaimPaymentNum"
  end

  create_table :equipment, primary_key: "EquipmentNum", id: :bigint do |t|
    t.text     :Description!
    t.string   :SerialNumber
    t.string   :ModelYear         , 2
    t.date     :DatePurchased!    , ["0001-01-01"]
    t.date     :DateSold!         , ["0001-01-01"]
    t.float    :PurchaseCost!     , 53
    t.float    :MarketValue!      , 53
    t.text     :Location!
    t.date     :DateEntry!        , ["0001-01-01"]
    t.bigint   :ProvNumCheckedOut!
    t.date     :DateCheckedOut!   , ["0001-01-01"]
    t.date     :DateExpectedBack! , ["0001-01-01"]
    t.text     :DispenseNote!
    t.text     :Status!

    t.index    :ProvNumCheckedOut, name: "ProvNumCheckedOut"
  end

  create_table  :erxlog, primary_key: "ErxLogNum", id: :bigint do |t|
    t.bigint    :PatNum!
    t.text      :MsgText!   , size: :medium
    t.timestamp :DateTStamp!, [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.bigint    :ProvNum!
    t.bigint    :UserNum!

    t.index     :PatNum, name: "PatNum"
    t.index     :ProvNum, name: "ProvNum"
    t.index     :UserNum, name: "UserNum"
  end

  create_table :eservicelog, primary_key: "EServiceLogNum", id: :bigint do |t|
    t.datetime :LogDateTime!     , ["0001-01-01 00:00:00"]
    t.bigint   :PatNum!
    t.integer  :EServiceType     , 1
    t.integer  :EServiceAction   , 2
    t.integer  :KeyType          , 2
    t.string   :LogGuid!         , 36
    t.bigint   :ClinicNum
    t.bigint   :FKey
    t.datetime :DateTimeUploaded!, ["0001-01-01 12:00:00"]
    t.string   :Note!

    t.index   [:ClinicNum, :LogDateTime], name: "ClinicDateTime"
    t.index    :DateTimeUploaded, name: "DateTimeUploaded"
    t.index    :PatNum, name: "PatNum"
  end

  create_table :eserviceshortguid, primary_key: "EServiceShortGuidNum", id: :bigint do |t|
    t.string   :EServiceCode!
    t.string   :ShortGuid!
    t.string   :ShortURL!
    t.bigint   :FKey!
    t.string   :FKeyType!
    t.datetime :DateTimeExpiration!, ["0001-01-01 00:00:00"]
    t.datetime :DateTEntry!        , ["0001-01-01 00:00:00"]

    t.index    :FKey, name: "FKey"
    t.index    :ShortGuid, name: "ShortGuid"
  end

  create_table :eservicesignal, primary_key: "EServiceSignalNum", id: :bigint do |t|
    t.integer  :ServiceCode!
    t.integer  :ReasonCategory!
    t.integer  :ReasonCode!
    t.integer  :Severity!      , 1
    t.text     :Description!
    t.datetime :SigDateTime!   , ["0001-01-01 00:00:00"]
    t.text     :Tag!
    t.integer  :IsProcessed!   , 1
  end

  create_table :etrans, primary_key: "EtransNum", id: :bigint do |t|
    t.datetime :DateTimeTrans!       , ["0001-01-01 00:00:00"]
    t.bigint   :ClearingHouseNum!
    t.integer  :Etype!               , 1, unsigned: true
    t.bigint   :ClaimNum!
    t.integer  :OfficeSequenceNumber!
    t.integer  :CarrierTransCounter!
    t.integer  :CarrierTransCounter2!
    t.bigint   :CarrierNum!
    t.bigint   :CarrierNum2!
    t.bigint   :PatNum!
    t.integer  :BatchNumber!
    t.string   :AckCode
    t.integer  :TransSetNum!
    t.text     :Note
    t.bigint   :EtransMessageTextNum!
    t.bigint   :AckEtransNum!
    t.bigint   :PlanNum!
    t.bigint   :InsSubNum!
    t.string   :TranSetId835!
    t.string   :CarrierNameRaw!      , 60
    t.string   :PatientNameRaw!      , 133
    t.bigint   :UserNum!

    t.index    :AckEtransNum, name: "AckEtransNum"
    t.index    :CarrierNum, name: "CarrierNum"
    t.index    :CarrierNum2, name: "CarrierNum2"
    t.index    :ClaimNum, name: "ClaimNum"
    t.index    :ClearingHouseNum, name: "ClearingHouseNum"
    t.index    :EtransMessageTextNum, name: "EtransMessageTextNum"
    t.index   [:Etype, :DateTimeTrans], name: "EtransTypeAndDate"
    t.index    :InsSubNum, name: "InsSubNum"
    t.index    :PatNum, name: "PatNum"
    t.index    :PlanNum, name: "PlanNum"
    t.index    :UserNum, name: "UserNum"
  end

  create_table :etrans835, primary_key: "Etrans835Num", id: :bigint do |t|
    t.bigint   :EtransNum!
    t.string   :PayerName!        , 60
    t.string   :TransRefNum!      , 50
    t.float    :InsPaid!          , 53
    t.string   :ControlId!        , 9
    t.string   :PaymentMethodCode!, 3
    t.string   :PatientName!      , 100
    t.integer  :Status!           , 1
    t.integer  :AutoProcessed!    , 1
    t.integer  :IsApproved!       , 1

    t.index    :EtransNum, name: "EtransNum"
  end

  create_table :etrans835attach, primary_key: "Etrans835AttachNum", id: :bigint do |t|
    t.bigint   :EtransNum!
    t.bigint   :ClaimNum!
    t.integer  :ClpSegmentIndex!
    t.datetime :DateTimeEntry!  , ["0001-01-01 00:00:00"]

    t.index    :ClaimNum, name: "ClaimNum"
    t.index    :EtransNum, name: "EtransNum"
  end

  create_table :etransmessagetext, primary_key: "EtransMessageTextNum", id: :bigint do |t|
    t.text     :MessageText!, size: :medium
  end

  create_table :evaluation, primary_key: "EvaluationNum", id: :bigint do |t|
    t.bigint   :InstructNum!
    t.bigint   :StudentNum!
    t.bigint   :SchoolCourseNum!
    t.string   :EvalTitle!
    t.date     :DateEval!           , ["0001-01-01"]
    t.bigint   :GradingScaleNum!
    t.string   :OverallGradeShowing!
    t.float    :OverallGradeNumber!
    t.text     :Notes!

    t.index    :GradingScaleNum, name: "GradingScaleNum"
    t.index    :InstructNum, name: "InstructNum"
    t.index    :SchoolCourseNum, name: "SchoolCourseNum"
    t.index    :StudentNum, name: "StudentNum"
  end

  create_table :evaluationcriterion, primary_key: "EvaluationCriterionNum", id: :bigint do |t|
    t.bigint   :EvaluationNum!
    t.string   :CriterionDescript!
    t.integer  :IsCategoryName!   , 1
    t.bigint   :GradingScaleNum!
    t.string   :GradeShowing!
    t.float    :GradeNumber!
    t.text     :Notes!
    t.integer  :ItemOrder!
    t.float    :MaxPointsPoss!

    t.index    :EvaluationNum, name: "EvaluationNum"
    t.index    :GradingScaleNum, name: "GradingScaleNum"
  end

  create_table :evaluationcriteriondef, primary_key: "EvaluationCriterionDefNum", id: :bigint do |t|
    t.bigint   :EvaluationDefNum!
    t.string   :CriterionDescript!
    t.integer  :IsCategoryName!   , 1
    t.bigint   :GradingScaleNum!
    t.integer  :ItemOrder!
    t.float    :MaxPointsPoss!

    t.index    :EvaluationDefNum, name: "EvaluationDefNum"
    t.index    :GradingScaleNum, name: "GradingScaleNum"
  end

  create_table :evaluationdef, primary_key: "EvaluationDefNum", id: :bigint do |t|
    t.bigint   :SchoolCourseNum!
    t.string   :EvalTitle!
    t.bigint   :GradingScaleNum!

    t.index    :GradingScaleNum, name: "GradingScaleNum"
    t.index    :SchoolCourseNum, name: "SchoolCourseNum"
  end

  create_table :famaging, primary_key: "PatNum", id: :bigint do |t|
    t.float    :Bal_0_30!  , 53
    t.float    :Bal_31_60! , 53
    t.float    :Bal_61_90! , 53
    t.float    :BalOver90! , 53
    t.float    :InsEst!    , 53
    t.float    :BalTotal!  , 53
    t.float    :PayPlanDue!, 53
  end

  create_table :familyhealth, primary_key: "FamilyHealthNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.integer  :Relationship! , 1
    t.bigint   :DiseaseDefNum!
    t.string   :PersonName!

    t.index    :DiseaseDefNum, name: "DiseaseDefNum"
    t.index    :PatNum, name: "PatNum"
  end

  create_table  :fee, primary_key: "FeeNum", id: :bigint do |t|
    t.float     :Amount!         , 53, [0.0]
    t.string    :OldCode!        , 15, [""], collation: "utf8mb3_bin"
    t.bigint    :FeeSched!
    t.integer   :UseDefaultFee!  , 1, [0], unsigned: true
    t.integer   :UseDefaultCov!  , 1, [0], unsigned: true
    t.bigint    :CodeNum!
    t.bigint    :ClinicNum!
    t.bigint    :ProvNum!
    t.bigint    :SecUserNumEntry!
    t.date      :SecDateEntry!   , ["0001-01-01"]
    t.timestamp :SecDateTEdit!   , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]

    t.index     :ClinicNum, name: "ClinicNum"
    t.index     :CodeNum, name: "CodeNum"
    t.index    [:FeeSched, :CodeNum, :ClinicNum, :ProvNum], name: "FeeSchedCodeClinicProv"
    t.index     :OldCode, name: "indexADACode"
    t.index     :ProvNum, name: "ProvNum"
    t.index     :SecUserNumEntry, name: "SecUserNumEntry"
  end

  create_table  :feesched, primary_key: "FeeSchedNum", id: :bigint do |t|
    t.string    :Description
    t.integer   :FeeSchedType!
    t.integer   :ItemOrder!
    t.boolean   :IsHidden!
    t.integer   :IsGlobal!       , 1
    t.bigint    :SecUserNumEntry!
    t.date      :SecDateEntry!   , ["0001-01-01"]
    t.timestamp :SecDateTEdit!   , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]

    t.index     :SecUserNumEntry, name: "SecUserNumEntry"
  end

  create_table :feeschedgroup, primary_key: "FeeSchedGroupNum", id: :bigint do |t|
    t.string   :Description!
    t.bigint   :FeeSchedNum!
    t.string   :ClinicNums!

    t.index    :FeeSchedNum, name: "FeeSchedNum"
  end

  create_table :fhircontactpoint, primary_key: "FHIRContactPointNum", id: :bigint do |t|
    t.bigint   :FHIRSubscriptionNum!
    t.integer  :ContactSystem!      , 1
    t.string   :ContactValue!
    t.integer  :ContactUse!         , 1
    t.integer  :ItemOrder!
    t.date     :DateStart!          , ["0001-01-01"]
    t.date     :DateEnd!            , ["0001-01-01"]

    t.index    :FHIRSubscriptionNum, name: "FHIRSubscriptionNum"
  end

  create_table :fhirsubscription, primary_key: "FHIRSubscriptionNum", id: :bigint do |t|
    t.string   :Criteria!
    t.string   :Reason!
    t.integer  :SubStatus!      , 1
    t.text     :ErrorNote!
    t.integer  :ChannelType!    , 1
    t.string   :ChannelEndpoint!
    t.string   :ChannelPayLoad!
    t.string   :ChannelHeader!
    t.datetime :DateEnd!        , ["0001-01-01 00:00:00"]
    t.string   :APIKeyHash!
  end

  create_table :fielddeflink, primary_key: "FieldDefLinkNum", id: :bigint do |t|
    t.bigint   :FieldDefNum!
    t.integer  :FieldDefType! , 1
    t.integer  :FieldLocation!, 1

    t.index    :FieldDefNum, name: "FieldDefNum"
  end

  create_table :files, primary_key: "DocNum", id: :bigint do |t|
    t.binary   :Data!    , size: :long
    t.binary   :Thumbnail, size: :long
  end

  create_table :formpat, primary_key: "FormPatNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.datetime :FormDateTime!, ["0001-01-01 00:00:00"]

    t.index    :PatNum, name: "PatNum"
  end

  create_table :gradingscale, primary_key: "GradingScaleNum", id: :bigint do |t|
    t.string   :Description!
    t.integer  :ScaleType!  , 1
  end

  create_table :gradingscaleitem, primary_key: "GradingScaleItemNum", id: :bigint do |t|
    t.bigint   :GradingScaleNum!
    t.string   :GradeShowing!
    t.float    :GradeNumber!
    t.string   :Description!

    t.index    :GradingScaleNum, name: "GradingScaleNum"
  end

  create_table :grouppermission, primary_key: "GroupPermNum", id: :bigint do |t|
    t.date     :NewerDate!   , ["0001-01-01"]
    t.integer  :NewerDays!
    t.bigint   :UserGroupNum!
    t.integer  :PermType!    , 1, [0], unsigned: true
    t.bigint   :FKey!

    t.index    :FKey, name: "FKey"
    t.index    :UserGroupNum, name: "UserGroupNum"
  end

  create_table :guardian, primary_key: "GuardianNum", id: :bigint do |t|
    t.bigint   :PatNumChild!
    t.bigint   :PatNumGuardian!
    t.integer  :Relationship!  , 1
    t.integer  :IsGuardian!    , 1

    t.index    :PatNumChild, name: "PatNumChild"
    t.index    :PatNumGuardian, name: "PatNumGuardian"
  end

  create_table :hcpcs, primary_key: "HcpcsNum", id: :bigint do |t|
    t.string   :HcpcsCode!
    t.string   :DescriptionShort!

    t.index    :HcpcsCode, name: "HcpcsCode"
  end

  create_table :hieclinic, primary_key: "HieClinicNum", id: :bigint do |t|
    t.bigint   :ClinicNum!
    t.integer  :SupportedCarrierFlags!, 1
    t.string   :PathExportCCD!
    t.bigint   :TimeOfDayExportCCD!
    t.integer  :IsEnabled!            , 1

    t.index    :ClinicNum, name: "ClinicNum"
    t.index    :TimeOfDayExportCCD, name: "TimeOfDayExportCCD"
  end

  create_table :hiequeue, primary_key: "HieQueueNum", id: :bigint do |t|
    t.bigint   :PatNum!

    t.index    :PatNum, name: "PatNum"
  end

  create_table  :histappointment, primary_key: "HistApptNum", id: :bigint do |t|
    t.bigint    :HistUserNum!
    t.datetime  :HistDateTStamp!       , ["0001-01-01 00:00:00"]
    t.integer   :HistApptAction!       , 1
    t.integer   :ApptSource!           , 1
    t.bigint    :AptNum!
    t.bigint    :PatNum!
    t.integer   :AptStatus!            , 1
    t.string    :Pattern!
    t.bigint    :Confirmed!
    t.integer   :TimeLocked!           , 1
    t.bigint    :Op!
    t.text      :Note!
    t.bigint    :ProvNum!
    t.bigint    :ProvHyg!
    t.datetime  :AptDateTime!          , ["0001-01-01 00:00:00"]
    t.bigint    :NextAptNum!
    t.bigint    :UnschedStatus!
    t.integer   :IsNewPatient!         , 1
    t.string    :ProcDescript!
    t.bigint    :Assistant!
    t.bigint    :ClinicNum!
    t.integer   :IsHygiene!            , 1
    t.timestamp :DateTStamp!           , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.datetime  :DateTimeArrived!      , ["0001-01-01 00:00:00"]
    t.datetime  :DateTimeSeated!       , ["0001-01-01 00:00:00"]
    t.datetime  :DateTimeDismissed!    , ["0001-01-01 00:00:00"]
    t.bigint    :InsPlan1!
    t.bigint    :InsPlan2!
    t.datetime  :DateTimeAskedToArrive!, ["0001-01-01 00:00:00"]
    t.text      :ProcsColored!
    t.integer   :ColorOverride!
    t.bigint    :AppointmentTypeNum!
    t.bigint    :SecUserNumEntry!
    t.datetime  :SecDateTEntry!        , ["0001-01-01 00:00:00"]
    t.integer   :Priority!             , 1
    t.string    :ProvBarText!          , 60
    t.string    :PatternSecondary!
    t.string    :SecurityHash!

    t.index     :AppointmentTypeNum, name: "AppointmentTypeNum"
    t.index     :AptNum, name: "AptNum"
    t.index     :Assistant, name: "Assistant"
    t.index     :ClinicNum, name: "ClinicNum"
    t.index     :Confirmed, name: "Confirmed"
    t.index     :HistUserNum, name: "HistUserNum"
    t.index     :InsPlan1, name: "InsPlan1"
    t.index     :InsPlan2, name: "InsPlan2"
    t.index     :NextAptNum, name: "NextAptNum"
    t.index     :Op, name: "Op"
    t.index     :PatNum, name: "PatNum"
    t.index     :ProvHyg, name: "ProvHyg"
    t.index     :ProvNum, name: "ProvNum"
    t.index     :SecUserNumEntry, name: "SecUserNumEntry"
    t.index     :UnschedStatus, name: "UnschedStatus"
  end

  create_table :hl7def, primary_key: "HL7DefNum", id: :bigint do |t|
    t.string   :Description!
    t.integer  :ModeTx!               , 1
    t.string   :IncomingFolder!
    t.string   :OutgoingFolder!
    t.string   :IncomingPort!
    t.string   :OutgoingIpPort!
    t.string   :FieldSeparator!       , 5
    t.string   :ComponentSeparator!   , 5
    t.string   :SubcomponentSeparator!, 5
    t.string   :RepetitionSeparator!  , 5
    t.string   :EscapeCharacter!      , 5
    t.integer  :IsInternal!           , 1
    t.string   :InternalType!
    t.string   :InternalTypeVersion!  , 50
    t.integer  :IsEnabled!            , 1
    t.text     :Note!
    t.string   :HL7Server!
    t.string   :HL7ServiceName!
    t.integer  :ShowDemographics!     , 1
    t.integer  :ShowAppts!            , 1
    t.integer  :ShowAccount!          , 1
    t.integer  :IsQuadAsToothNum!     , 1
    t.bigint   :LabResultImageCat!
    t.string   :SftpUsername!
    t.string   :SftpPassword!
    t.string   :SftpInSocket!
    t.integer  :HasLongDCodes!        , 1
    t.integer  :IsProcApptEnforced!   , 1

    t.index    :LabResultImageCat, name: "LabResultImageCat"
  end

  create_table :hl7deffield, primary_key: "HL7DefFieldNum", id: :bigint do |t|
    t.bigint   :HL7DefSegmentNum!
    t.integer  :OrdinalPos!
    t.string   :TableId!
    t.string   :DataType!
    t.string   :FieldName!
    t.text     :FixedText!

    t.index    :HL7DefSegmentNum, name: "HL7DefSegmentNum"
  end

  create_table :hl7defmessage, primary_key: "HL7DefMessageNum", id: :bigint do |t|
    t.bigint   :HL7DefNum!
    t.string   :MessageType!
    t.string   :EventType!
    t.integer  :InOrOut!         , 1
    t.integer  :ItemOrder!
    t.text     :Note!
    t.string   :MessageStructure!

    t.index    :HL7DefNum, name: "HL7DefNum"
  end

  create_table :hl7defsegment, primary_key: "HL7DefSegmentNum", id: :bigint do |t|
    t.bigint   :HL7DefMessageNum!
    t.integer  :ItemOrder!
    t.integer  :CanRepeat!       , 1
    t.integer  :IsOptional!      , 1
    t.string   :SegmentName!
    t.text     :Note!

    t.index    :HL7DefMessageNum, name: "HL7DefMessageNum"
  end

  create_table  :hl7msg, primary_key: "HL7MsgNum", id: :bigint do |t|
    t.integer   :HL7Status!
    t.text      :MsgText    , size: :medium
    t.bigint    :AptNum!
    t.timestamp :DateTStamp!, [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.bigint    :PatNum!
    t.text      :Note!

    t.index     :AptNum, name: "AptNum"
    t.index     :DateTStamp, name: "DateTStamp"
    t.index     :HL7Status, name: "HL7Status"
    t.index     :MsgText, name: "MsgText", 100
    t.index     :PatNum, name: "PatNum"
  end

  create_table :hl7procattach, primary_key: "HL7ProcAttachNum", id: :bigint do |t|
    t.bigint   :HL7MsgNum!
    t.bigint   :ProcNum!

    t.index    :HL7MsgNum, name: "HL7MsgNum"
    t.index    :ProcNum, name: "ProcNum"
  end

  create_table :icd10, primary_key: "Icd10Num", id: :bigint do |t|
    t.string   :Icd10Code!
    t.string   :Description!
    t.string   :IsCode!

    t.index    :Icd10Code, name: "Icd10Code"
  end

  create_table  :icd9, primary_key: "ICD9Num", id: :bigint do |t|
    t.string    :ICD9Code!
    t.string    :Description!
    t.timestamp :DateTStamp! , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]

    t.index     :ICD9Code, name: "ICD9Code"
  end

  create_table :imagedraw, primary_key: "ImageDrawNum", id: :bigint do |t|
    t.bigint   :DocNum!
    t.bigint   :MountNum!
    t.integer  :ColorDraw!
    t.integer  :ColorBack!
    t.text     :DrawingSegment!
    t.string   :DrawText!
    t.float    :FontSize!
    t.integer  :DrawType!      , 1

    t.index    :DocNum, name: "DocNum"
    t.index    :MountNum, name: "MountNum"
  end

  create_table :imagingdevice, primary_key: "ImagingDeviceNum", id: :bigint do |t|
    t.string   :Description!
    t.string   :ComputerName!
    t.integer  :DeviceType!  , 1
    t.string   :TwainName!
    t.integer  :ItemOrder!
    t.integer  :ShowTwainUI! , 1
  end

  create_table :insbluebook, primary_key: "InsBlueBookNum", id: :bigint do |t|
    t.bigint   :ProcCodeNum!
    t.bigint   :CarrierNum!
    t.bigint   :PlanNum!
    t.string   :GroupNum!       , 25
    t.float    :InsPayAmt!      , 53
    t.float    :AllowedOverride!, 53
    t.datetime :DateTEntry!     , ["0001-01-01 00:00:00"]
    t.bigint   :ProcNum!
    t.date     :ProcDate!       , ["0001-01-01"]
    t.string   :ClaimType!      , 10
    t.bigint   :ClaimNum!

    t.index    :CarrierNum, name: "CarrierNum"
    t.index    :ClaimNum, name: "ClaimNum"
    t.index    :PlanNum, name: "PlanNum"
    t.index    :ProcCodeNum, name: "ProcCodeNum"
    t.index    :ProcNum, name: "ProcNum"
  end

  create_table :insbluebooklog, primary_key: "InsBlueBookLogNum", id: :bigint do |t|
    t.bigint   :ClaimProcNum!
    t.float    :AllowedFee!  , 53
    t.datetime :DateTEntry!  , ["0001-01-01 00:00:00"]
    t.text     :Description!

    t.index    :ClaimProcNum, name: "ClaimProcNum"
  end

  create_table :insbluebookrule, primary_key: "InsBlueBookRuleNum", id: :bigint do |t|
    t.integer  :ItemOrder! , 2
    t.integer  :RuleType!  , 1
    t.integer  :LimitValue!
    t.integer  :LimitType! , 1
  end

  create_table  :inseditlog, primary_key: "InsEditLogNum", id: :bigint do |t|
    t.bigint    :FKey!
    t.integer   :LogType!    , 1
    t.string    :FieldName!
    t.string    :OldValue!
    t.string    :NewValue!
    t.bigint    :UserNum!
    t.timestamp :DateTStamp! , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.bigint    :ParentKey!
    t.string    :Description!

    t.index    [:LogType, :FKey], name: "FKeyType"
    t.index     :ParentKey, name: "ParentKey"
    t.index     :UserNum, name: "UserNum"
  end

  create_table  :inseditpatlog, primary_key: "InsEditPatLogNum", id: :bigint do |t|
    t.bigint    :FKey!
    t.integer   :LogType!    , 1
    t.string    :FieldName!
    t.string    :OldValue!
    t.string    :NewValue!
    t.bigint    :UserNum!
    t.timestamp :DateTStamp! , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.bigint    :ParentKey!
    t.string    :Description!

    t.index    [:FKey, :LogType], name: "FkLogType"
    t.index     :ParentKey, name: "ParentKey"
    t.index     :UserNum, name: "UserNum"
  end

  create_table :insfilingcode, primary_key: "InsFilingCodeNum", id: :bigint do |t|
    t.string   :Descript
    t.string   :EclaimCode                      , 100
    t.integer  :ItemOrder
    t.bigint   :GroupType!
    t.integer  :ExcludeOtherCoverageOnPriClaims!, 1

    t.index    :GroupType, name: "GroupType"
    t.index    :ItemOrder, name: "ItemOrder"
  end

  create_table :insfilingcodesubtype, primary_key: "InsFilingCodeSubtypeNum", id: :bigint do |t|
    t.bigint   :InsFilingCodeNum!
    t.string   :Descript

    t.index    :InsFilingCodeNum, name: "InsFilingCodeNum"
  end

  create_table  :insplan, primary_key: "PlanNum", id: :bigint do |t|
    t.string    :GroupName                                  , 50, [""]
    t.string    :GroupNum                                   , 25
    t.text      :PlanNote!
    t.bigint    :FeeSched!
    t.string    :PlanType                                   , 1, [""]
    t.bigint    :ClaimFormNum!
    t.integer   :UseAltCode!                                , 1, [0], unsigned: true
    t.integer   :ClaimsUseUCR!                              , 1, [0], unsigned: true
    t.bigint    :CopayFeeSched!
    t.bigint    :EmployerNum!
    t.bigint    :CarrierNum!
    t.bigint    :AllowedFeeSched!
    t.string    :TrojanID                                   , 100, [""]
    t.string    :DivisionNo                                 , [""]
    t.integer   :IsMedical!                                 , 1, [0], unsigned: true
    t.bigint    :FilingCode!
    t.integer   :DentaideCardSequence!                      , 1, unsigned: true
    t.boolean   :ShowBaseUnits!
    t.boolean   :CodeSubstNone!
    t.integer   :IsHidden!                                  , 1
    t.integer   :MonthRenew!                                , 1
    t.bigint    :FilingCodeSubtype!
    t.string    :CanadianPlanFlag!                          , 5
    t.string    :CanadianDiagnosticCode!
    t.string    :CanadianInstitutionCode!
    t.string    :RxBIN!
    t.integer   :CobRule!                                   , 1
    t.string    :SopCode!
    t.bigint    :SecUserNumEntry!
    t.date      :SecDateEntry!                              , ["0001-01-01"]
    t.timestamp :SecDateTEdit!                              , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.integer   :HideFromVerifyList!                        , 1
    t.integer   :OrthoType!                                 , 1
    t.integer   :OrthoAutoProcFreq!                         , 1
    t.bigint    :OrthoAutoProcCodeNumOverride!
    t.float     :OrthoAutoFeeBilled!                        , 53
    t.integer   :OrthoAutoClaimDaysWait!
    t.bigint    :BillingType!
    t.integer   :HasPpoSubstWriteoffs!                      , 1
    t.integer   :ExclusionFeeRule!                          , 1
    t.bigint    :ManualFeeSchedNum!                         , [0]
    t.integer   :IsBlueBookEnabled!                         , 1, [1]
    t.integer   :InsPlansZeroWriteOffsOnAnnualMaxOverride!  , 1
    t.integer   :InsPlansZeroWriteOffsOnFreqOrAgingOverride!, 1

    t.index     :AllowedFeeSched, name: "AllowedFeeSched"
    t.index     :BillingType, name: "BillingType"
    t.index    [:CarrierNum, :PlanNum], name: "CarrierNumPlanNum"
    t.index     :CarrierNum, name: "CarrierNum"
    t.index     :CopayFeeSched, name: "CopayFeeSched"
    t.index     :FeeSched, name: "FeeSched"
    t.index     :FilingCodeSubtype, name: "FilingCodeSubtype"
    t.index     :ManualFeeSchedNum, name: "ManualFeeSchedNum"
    t.index     :OrthoAutoProcCodeNumOverride, name: "OrthoAutoProcCodeNumOverride"
    t.index     :SecUserNumEntry, name: "SecUserNumEntry"
    t.index     :TrojanID, name: "TrojanID"
  end

  create_table :insplanpreference, primary_key: "InsPlanPrefNum", id: :bigint do |t|
    t.bigint   :PlanNum!
    t.bigint   :FKey!
    t.integer  :FKeyType!   , 1
    t.text     :ValueString!

    t.index    :FKey, name: "FKey"
    t.index    :PlanNum, name: "PlanNum"
  end

  create_table  :inssub, primary_key: "InsSubNum", id: :bigint do |t|
    t.bigint    :PlanNum!
    t.bigint    :Subscriber!
    t.date      :DateEffective!  , ["0001-01-01"]
    t.date      :DateTerm!       , ["0001-01-01"]
    t.integer   :ReleaseInfo!    , 1
    t.integer   :AssignBen!      , 1
    t.string    :SubscriberID!
    t.text      :BenefitNotes!
    t.text      :SubscNote!
    t.bigint    :SecUserNumEntry!
    t.date      :SecDateEntry!   , ["0001-01-01"]
    t.timestamp :SecDateTEdit!   , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]

    t.index     :PlanNum, name: "PlanNum"
    t.index     :SecUserNumEntry, name: "SecUserNumEntry"
    t.index     :Subscriber, name: "Subscriber"
  end

  create_table :installmentplan, primary_key: "InstallmentPlanNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.date     :DateAgreement!   , ["0001-01-01"]
    t.date     :DateFirstPayment!, ["0001-01-01"]
    t.float    :MonthlyPayment!  , 53
    t.float    :APR!
    t.string   :Note!

    t.index    :PatNum, name: "PatNum"
  end

  create_table :instructor, primary_key: "InstructorNum" do |t|
    t.string   :LName , [""]
    t.string   :FName , [""]
    t.string   :Suffix, 100, [""]
  end

  create_table  :insverify, primary_key: "InsVerifyNum", id: :bigint do |t|
    t.date      :DateLastVerified!             , ["0001-01-01"]
    t.bigint    :UserNum!
    t.integer   :VerifyType!                   , 1
    t.bigint    :FKey!
    t.bigint    :DefNum!
    t.text      :Note!
    t.date      :DateLastAssigned!             , ["0001-01-01"]
    t.datetime  :DateTimeEntry!                , ["0001-01-01 00:00:00"]
    t.float     :HoursAvailableForVerification!, 53
    t.timestamp :SecDateTEdit!                 , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]

    t.index     :DateLastAssigned, name: "DateLastAssigned"
    t.index     :DateTimeEntry, name: "DateTimeEntry"
    t.index     :DefNum, name: "DefNum"
    t.index     :FKey, name: "FKey"
    t.index     :SecDateTEdit, name: "SecDateTEdit"
    t.index     :UserNum, name: "UserNum"
    t.index     :VerifyType, name: "VerifyType"
  end

  create_table  :insverifyhist, primary_key: "InsVerifyHistNum", id: :bigint do |t|
    t.bigint    :InsVerifyNum!
    t.date      :DateLastVerified!             , ["0001-01-01"]
    t.bigint    :UserNum!
    t.integer   :VerifyType!                   , 1
    t.bigint    :FKey!
    t.bigint    :DefNum!
    t.text      :Note!
    t.date      :DateLastAssigned!             , ["0001-01-01"]
    t.datetime  :DateTimeEntry!                , ["0001-01-01 00:00:00"]
    t.float     :HoursAvailableForVerification!, 53
    t.bigint    :VerifyUserNum!
    t.timestamp :SecDateTEdit!                 , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]

    t.index     :DefNum, name: "DefNum"
    t.index     :FKey, name: "FKey"
    t.index     :InsVerifyNum, name: "InsVerifyNum"
    t.index     :SecDateTEdit, name: "SecDateTEdit"
    t.index     :UserNum, name: "UserNum"
    t.index     :VerifyUserNum, name: "VerifyUserNum"
  end

  create_table :intervention, primary_key: "InterventionNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.bigint   :ProvNum!
    t.string   :CodeValue!    , 30
    t.string   :CodeSystem!   , 30
    t.text     :Note!
    t.date     :DateEntry!    , ["0001-01-01"]
    t.integer  :CodeSet!      , 1
    t.integer  :IsPatDeclined!, 1

    t.index    :CodeValue, name: "CodeValue"
    t.index    :PatNum, name: "PatNum"
    t.index    :ProvNum, name: "ProvNum"
  end

  create_table  :journalentry, primary_key: "JournalEntryNum", id: :bigint do |t|
    t.bigint    :TransactionNum!
    t.bigint    :AccountNum!
    t.date      :DateDisplayed!  , ["0001-01-01"]
    t.float     :DebitAmt!       , 53, [0.0]
    t.float     :CreditAmt!      , 53, [0.0]
    t.text      :Memo
    t.text      :Splits
    t.string    :CheckNumber     , [""]
    t.bigint    :ReconcileNum!
    t.bigint    :SecUserNumEntry!
    t.datetime  :SecDateTEntry!  , ["0001-01-01 00:00:00"]
    t.bigint    :SecUserNumEdit!
    t.timestamp :SecDateTEdit!   , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]

    t.index     :AccountNum, name: "indexAccountNum"
    t.index     :SecUserNumEdit, name: "SecUserNumEdit"
    t.index     :SecUserNumEntry, name: "SecUserNumEntry"
    t.index     :TransactionNum, name: "indexTransactionNum"
  end

  create_table  :labcase, primary_key: "LabCaseNum", id: :bigint do |t|
    t.bigint    :PatNum!
    t.bigint    :LaboratoryNum!
    t.bigint    :AptNum!
    t.bigint    :PlannedAptNum!
    t.datetime  :DateTimeDue!    , ["0001-01-01 00:00:00"]
    t.datetime  :DateTimeCreated!, ["0001-01-01 00:00:00"]
    t.datetime  :DateTimeSent!   , ["0001-01-01 00:00:00"]
    t.datetime  :DateTimeRecd!   , ["0001-01-01 00:00:00"]
    t.datetime  :DateTimeChecked!, ["0001-01-01 00:00:00"]
    t.bigint    :ProvNum!
    t.text      :Instructions
    t.float     :LabFee!         , 53
    t.timestamp :DateTStamp!     , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.string    :InvoiceNum!

    t.index     :AptNum, name: "indexAptNum"
  end

  create_table :laboratory, primary_key: "LaboratoryNum", id: :bigint do |t|
    t.string   :Description
    t.string   :Phone
    t.text     :Notes
    t.bigint   :Slip!
    t.string   :Address!
    t.string   :City!
    t.string   :State!
    t.string   :Zip!
    t.string   :Email!
    t.string   :WirelessPhone!
    t.integer  :IsHidden!     , 1
  end

  create_table  :labpanel, primary_key: "LabPanelNum", id: :bigint do |t|
    t.bigint    :PatNum!
    t.text      :RawMessage!
    t.string    :LabNameAddress!
    t.timestamp :DateTStamp!       , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.string    :SpecimenCondition!
    t.string    :SpecimenSource!
    t.string    :ServiceId!
    t.string    :ServiceName!
    t.bigint    :MedicalOrderNum!

    t.index     :MedicalOrderNum, name: "MedicalOrderNum"
    t.index     :PatNum, name: "PatNum"
  end

  create_table  :labresult, primary_key: "LabResultNum", id: :bigint do |t|
    t.bigint    :LabPanelNum!
    t.datetime  :DateTimeTest!, ["0001-01-01 00:00:00"]
    t.string    :TestName!
    t.timestamp :DateTStamp!  , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.string    :TestID!
    t.string    :ObsValue!
    t.string    :ObsUnits!
    t.string    :ObsRange!
    t.integer   :AbnormalFlag!, 1

    t.index     :LabPanelNum, name: "LabPanelNum"
  end

  create_table :labturnaround, primary_key: "LabTurnaroundNum", id: :bigint do |t|
    t.bigint   :LaboratoryNum!
    t.string   :Description
    t.integer  :DaysPublished!, 2
    t.integer  :DaysActual!   , 2
  end

  create_table :language, primary_key: "LanguageNum", id: :bigint do |t|
    t.text     :EnglishComments
    t.text     :ClassType
    t.text     :English
    t.integer  :IsObsolete!    , 1, [0], unsigned: true
  end

  create_table :languageforeign, primary_key: "LanguageForeignNum", id: :bigint do |t|
    t.text     :ClassType
    t.text     :English
    t.string   :Culture    , [""]
    t.text     :Translation
    t.text     :Comments
  end

  create_table :letter, primary_key: "LetterNum", id: :bigint do |t|
    t.string   :Description, [""]
    t.text     :BodyText
  end

  create_table :lettermerge, primary_key: "LetterMergeNum", id: :bigint do |t|
    t.string   :Description , [""]
    t.string   :TemplateName, [""]
    t.string   :DataFileName, [""]
    t.bigint   :Category!
    t.bigint   :ImageFolder!
  end

  create_table :lettermergefield, primary_key: "FieldNum", id: :bigint do |t|
    t.bigint   :LetterMergeNum!
    t.string   :FieldName      , [""]
  end

  create_table :limitedbetafeature, primary_key: "LimitedBetaFeatureNum", id: :bigint do |t|
    t.bigint   :LimitedBetaFeatureTypeNum!
    t.bigint   :ClinicNum!
    t.integer  :IsSignedUp!               , 1

    t.index    :ClinicNum, name: "ClinicNum"
    t.index    :LimitedBetaFeatureTypeNum, name: "LimitedBetaFeatureTypeNum"
  end

  create_table :loginattempt, primary_key: "LoginAttemptNum", id: :bigint do |t|
    t.string   :UserName!
    t.integer  :LoginType!, 1
    t.datetime :DateTFail!, ["0001-01-01 00:00:00"]

    t.index    :UserName, name: "UserName", 10
  end

  create_table :loinc, primary_key: "LoincNum", id: :bigint do |t|
    t.string   :LoincCode!
    t.string   :Component!
    t.string   :PropertyObserved!
    t.string   :TimeAspct!
    t.string   :SystemMeasured!
    t.string   :ScaleType!
    t.string   :MethodType!
    t.string   :StatusOfCode!
    t.string   :NameShort!
    t.string   :ClassType!
    t.integer  :UnitsRequired!          , 1
    t.string   :OrderObs!
    t.string   :HL7FieldSubfieldID!
    t.text     :ExternalCopyrightNotice!
    t.string   :NameLongCommon!
    t.string   :UnitsUCUM!
    t.integer  :RankCommonTests!
    t.integer  :RankCommonOrders!

    t.index    :LoincCode, name: "LoincCode"
  end

  create_table :maparea, primary_key: "MapAreaNum", id: :bigint do |t|
    t.integer  :Extension!
    t.float    :XPos!               , 53
    t.float    :YPos!               , 53
    t.float    :Width!              , 53
    t.float    :Height!             , 53
    t.string   :Description!
    t.integer  :ItemType!           , 1
    t.bigint   :MapAreaContainerNum!

    t.index    :MapAreaContainerNum, name: "MapAreaContainerNum"
  end

  create_table :medicalorder, primary_key: "MedicalOrderNum", id: :bigint do |t|
    t.integer  :MedOrderType!  , 1
    t.bigint   :PatNum!
    t.datetime :DateTimeOrder! , ["0001-01-01 00:00:00"]
    t.string   :Description!
    t.integer  :IsDiscontinued!, 1
    t.bigint   :ProvNum!

    t.index    :PatNum, name: "PatNum"
    t.index    :ProvNum, name: "ProvNum"
  end

  create_table  :medication, primary_key: "MedicationNum", id: :bigint do |t|
    t.string    :MedName    , [""]
    t.bigint    :GenericNum!
    t.text      :Notes
    t.timestamp :DateTStamp!, [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.bigint    :RxCui!

    t.index     :RxCui, name: "RxCui"
  end

  create_table  :medicationpat, primary_key: "MedicationPatNum", id: :bigint do |t|
    t.bigint    :PatNum!
    t.bigint    :MedicationNum!
    t.text      :PatNote
    t.timestamp :DateTStamp!   , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.date      :DateStart!    , ["0001-01-01"]
    t.date      :DateStop!     , ["0001-01-01"]
    t.bigint    :ProvNum!
    t.string    :MedDescript!
    t.bigint    :RxCui!
    t.string    :ErxGuid!
    t.integer   :IsCpoe!       , 1

    t.index     :PatNum, name: "PatNum"
    t.index     :ProvNum, name: "ProvNum"
    t.index     :RxCui, name: "RxCui"
  end

  create_table :medlab, primary_key: "MedLabNum", id: :bigint do |t|
    t.string   :SendingApp!
    t.string   :SendingFacility!
    t.bigint   :PatNum!
    t.bigint   :ProvNum!
    t.string   :PatIDLab!
    t.string   :PatIDAlt!
    t.string   :PatAge!
    t.string   :PatAccountNum!
    t.integer  :PatFasting!         , 1
    t.string   :SpecimenID!
    t.string   :SpecimenIDFiller!
    t.string   :ObsTestID!
    t.string   :ObsTestDescript!
    t.string   :ObsTestLoinc!
    t.string   :ObsTestLoincText!
    t.datetime :DateTimeCollected!  , ["0001-01-01 00:00:00"]
    t.string   :TotalVolume!
    t.string   :ActionCode!
    t.string   :ClinicalInfo!
    t.datetime :DateTimeEntered!    , ["0001-01-01 00:00:00"]
    t.string   :OrderingProvNPI!
    t.string   :OrderingProvLocalID!
    t.string   :OrderingProvLName!
    t.string   :OrderingProvFName!
    t.string   :SpecimenIDAlt!
    t.datetime :DateTimeReported!   , ["0001-01-01 00:00:00"]
    t.string   :ResultStatus!
    t.string   :ParentObsID!
    t.string   :ParentObsTestID!
    t.text     :NotePat!
    t.text     :NoteLab!
    t.string   :FileName!
    t.text     :OriginalPIDSegment!

    t.index    :PatNum, name: "PatNum"
    t.index    :ProvNum, name: "ProvNum"
  end

  create_table :medlabfacattach, primary_key: "MedLabFacAttachNum", id: :bigint do |t|
    t.bigint   :MedLabNum!
    t.bigint   :MedLabResultNum!
    t.bigint   :MedLabFacilityNum!

    t.index    :MedLabFacilityNum, name: "MedLabFacilityNum"
    t.index    :MedLabNum, name: "MedLabNum"
    t.index    :MedLabResultNum, name: "MedLabResultNum"
  end

  create_table :medlabfacility, primary_key: "MedLabFacilityNum", id: :bigint do |t|
    t.string   :FacilityName!
    t.string   :Address!
    t.string   :City!
    t.string   :State!
    t.string   :Zip!
    t.string   :Phone!
    t.string   :DirectorTitle!
    t.string   :DirectorLName!
    t.string   :DirectorFName!
  end

  create_table :medlabresult, primary_key: "MedLabResultNum", id: :bigint do |t|
    t.bigint   :MedLabNum!
    t.string   :ObsID!
    t.string   :ObsText!
    t.string   :ObsLoinc!
    t.string   :ObsLoincText!
    t.string   :ObsIDSub!
    t.text     :ObsValue!
    t.string   :ObsSubType!
    t.string   :ObsUnits!
    t.string   :ReferenceRange!
    t.string   :AbnormalFlag!
    t.string   :ResultStatus!
    t.datetime :DateTimeObs!   , ["0001-01-01 00:00:00"]
    t.string   :FacilityID!
    t.bigint   :DocNum!
    t.text     :Note!

    t.index    :DocNum, name: "DocNum"
    t.index    :MedLabNum, name: "MedLabNum"
  end

  create_table :medlabspecimen, primary_key: "MedLabSpecimenNum", id: :bigint do |t|
    t.bigint   :MedLabNum!
    t.string   :SpecimenID!
    t.string   :SpecimenDescript!
    t.datetime :DateTimeCollected!, ["0001-01-01 00:00:00"]

    t.index    :MedLabNum, name: "MedLabNum"
  end

  create_table :mobileappdevice, primary_key: "MobileAppDeviceNum", id: :bigint do |t|
    t.bigint   :ClinicNum!
    t.string   :DeviceName!
    t.string   :UniqueID!
    t.integer  :IsAllowed!          , 1
    t.datetime :LastAttempt!        , ["0001-01-01 00:00:00"]
    t.datetime :LastLogin!          , ["0001-01-01 00:00:00"]
    t.bigint   :PatNum!
    t.datetime :LastCheckInActivity!, ["0001-01-01 00:00:00"]
    t.integer  :IsBYODDevice!       , 1
    t.integer  :DevicePage!         , 1
    t.bigint   :UserNum!

    t.index    :ClinicNum, name: "ClinicNum"
    t.index    :PatNum, name: "PatNum"
    t.index    :UserNum, name: "UserNum"
  end

  create_table :mobiledatabyte, primary_key: "MobileDataByteNum", id: :bigint do |t|
    t.text     :RawBase64Data!  , size: :medium
    t.text     :RawBase64Code!  , size: :medium
    t.text     :RawBase64Tag!   , size: :medium
    t.bigint   :PatNum!
    t.integer  :ActionType!     , 1
    t.datetime :DateTimeEntry!  , ["0001-01-01 00:00:00"]
    t.datetime :DateTimeExpires!, ["0001-01-01 00:00:00"]

    t.index    :PatNum, name: "PatNum"
    t.index    :RawBase64Code, name: "RawBase64Code", 16
  end

  create_table :mount, primary_key: "MountNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.bigint   :DocCategory!
    t.datetime :DateCreated!       , ["0001-01-01 00:00:00"]
    t.string   :Description!
    t.text     :Note!
    t.integer  :Width!
    t.integer  :Height!
    t.integer  :ColorBack!
    t.bigint   :ProvNum!
    t.integer  :ColorFore!
    t.integer  :ColorTextBack!
    t.integer  :FlipOnAcquire!     , 1
    t.integer  :AdjModeAfterSeries!, 1

    t.index    :PatNum, name: "PatNum"
  end

  create_table :mountdef, primary_key: "MountDefNum", id: :bigint do |t|
    t.string   :Description
    t.integer  :ItemOrder!
    t.integer  :Width!
    t.integer  :Height!
    t.integer  :ColorBack!
    t.integer  :ColorFore!
    t.integer  :ColorTextBack!
    t.string   :ScaleValue!
    t.bigint   :DefaultCat!
    t.integer  :FlipOnAcquire!     , 1
    t.integer  :AdjModeAfterSeries!, 1
  end

  create_table :mountitem, primary_key: "MountItemNum", id: :bigint do |t|
    t.bigint   :MountNum!
    t.integer  :Xpos!
    t.integer  :Ypos!
    t.integer  :ItemOrder!
    t.integer  :Width!
    t.integer  :Height!
    t.integer  :RotateOnAcquire!
    t.string   :ToothNumbers!
    t.text     :TextShowing!
    t.float    :FontSize!

    t.index    :MountNum, name: "MountNum"
  end

  create_table :mountitemdef, primary_key: "MountItemDefNum", id: :bigint do |t|
    t.bigint   :MountDefNum!
    t.integer  :Xpos!
    t.integer  :Ypos!
    t.integer  :Width!
    t.integer  :Height!
    t.integer  :ItemOrder!
    t.integer  :RotateOnAcquire!
    t.string   :ToothNumbers!
    t.text     :TextShowing!
    t.float    :FontSize!
  end

  create_table :oidexternal, primary_key: "OIDExternalNum", id: :bigint do |t|
    t.string   :IDType!
    t.bigint   :IDInternal!
    t.string   :IDExternal!
    t.string   :rootExternal!

    t.index   [:IDType, :IDInternal], name: "IDType"
    t.index   [:rootExternal, :IDExternal], name: "rootExternal", 62
  end

  create_table :oidinternal, primary_key: "OIDInternalNum", id: :bigint do |t|
    t.string   :IDType!
    t.string   :IDRoot!
  end

  create_table  :operatory, primary_key: "OperatoryNum", id: :bigint do |t|
    t.string    :OpName         , [""]
    t.string    :Abbrev         , [""]
    t.integer   :ItemOrder!     , 2, [0], unsigned: true
    t.integer   :IsHidden!      , 1, [0], unsigned: true
    t.bigint    :ProvDentist!
    t.bigint    :ProvHygienist!
    t.integer   :IsHygiene!     , 1, [0], unsigned: true
    t.bigint    :ClinicNum!
    t.timestamp :DateTStamp!    , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.integer   :SetProspective!, 1
    t.integer   :IsWebSched!    , 1
    t.integer   :IsNewPatAppt!  , 1

    t.index     :ClinicNum, name: "ClinicNum"
    t.index     :ProvDentist, name: "ProvDentist"
    t.index     :ProvHygienist, name: "ProvHygienist"
  end

  create_table :orionproc, primary_key: "OrionProcNum", id: :bigint do |t|
    t.bigint   :ProcNum!
    t.integer  :DPC!            , 1
    t.date     :DateScheduleBy! , ["0001-01-01"]
    t.date     :DateStopClock!  , ["0001-01-01"]
    t.integer  :Status2!
    t.integer  :IsOnCall!       , 1
    t.integer  :IsEffectiveComm!, 1
    t.integer  :IsRepair!       , 1
    t.integer  :DPCpost!        , 1

    t.index    :ProcNum, name: "ProcNum"
  end

  create_table  :orthocase, primary_key: "OrthoCaseNum", id: :bigint do |t|
    t.bigint    :PatNum!
    t.bigint    :ProvNum!
    t.bigint    :ClinicNum!
    t.float     :Fee!               , 53
    t.float     :FeeInsPrimary!     , 53
    t.float     :FeePat!            , 53
    t.date      :BandingDate!       , ["0001-01-01"]
    t.date      :DebondDate!        , ["0001-01-01"]
    t.date      :DebondDateExpected!, ["0001-01-01"]
    t.integer   :IsTransfer!        , 1
    t.bigint    :OrthoType!
    t.datetime  :SecDateTEntry!     , ["0001-01-01 00:00:00"]
    t.bigint    :SecUserNumEntry!
    t.timestamp :SecDateTEdit!      , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.integer   :IsActive!          , 1
    t.float     :FeeInsSecondary!   , 53

    t.index     :ClinicNum, name: "ClinicNum"
    t.index     :OrthoType, name: "OrthoType"
    t.index     :PatNum, name: "PatNum"
    t.index     :ProvNum, name: "ProvNum"
    t.index     :SecUserNumEntry, name: "SecUserNumEntry"
  end

  create_table :orthochart, primary_key: "OrthoChartNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.date     :DateService!     , ["0001-01-01"]
    t.string   :FieldName!
    t.text     :FieldValue!
    t.bigint   :UserNum!
    t.bigint   :ProvNum!
    t.bigint   :OrthoChartRowNum!

    t.index    :OrthoChartRowNum, name: "OrthoChartRowNum"
    t.index    :PatNum, name: "PatNum"
    t.index    :UserNum, name: "UserNum"
  end

  create_table :orthochartrow, primary_key: "OrthoChartRowNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.datetime :DateTimeService!, ["0001-01-01 00:00:00"]
    t.bigint   :UserNum!
    t.bigint   :ProvNum!
    t.text     :Signature!

    t.index    :PatNum, name: "PatNum"
    t.index    :ProvNum, name: "ProvNum"
    t.index    :UserNum, name: "UserNum"
  end

  create_table :orthocharttab, primary_key: "OrthoChartTabNum", id: :bigint do |t|
    t.string   :TabName!
    t.integer  :ItemOrder!
    t.integer  :IsHidden! , 1
  end

  create_table :orthocharttablink, primary_key: "OrthoChartTabLinkNum", id: :bigint do |t|
    t.integer  :ItemOrder!
    t.bigint   :OrthoChartTabNum!
    t.bigint   :DisplayFieldNum!
    t.integer  :ColumnWidthOverride!

    t.index    :DisplayFieldNum, name: "DisplayFieldNum"
    t.index    :OrthoChartTabNum, name: "OrthoChartTabNum"
  end

  create_table :orthohardware, primary_key: "OrthoHardwareNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.date     :DateExam!            , ["0001-01-01"]
    t.integer  :OrthoHardwareType!   , 1
    t.bigint   :OrthoHardwareSpecNum!
    t.string   :ToothRange!
    t.string   :Note!

    t.index    :PatNum, name: "PatNum"
  end

  create_table :orthohardwarespec, primary_key: "OrthoHardwareSpecNum", id: :bigint do |t|
    t.integer  :OrthoHardwareType!, 1
    t.string   :Description!
    t.integer  :ItemColor!
    t.integer  :IsHidden!         , 1
    t.integer  :ItemOrder!
  end

  create_table :orthoplanlink, primary_key: "OrthoPlanLinkNum", id: :bigint do |t|
    t.bigint   :OrthoCaseNum!
    t.integer  :LinkType!       , 1
    t.bigint   :FKey!
    t.integer  :IsActive!       , 1
    t.datetime :SecDateTEntry!  , ["0001-01-01 00:00:00"]
    t.bigint   :SecUserNumEntry!

    t.index    :FKey, name: "FKey"
    t.index    :OrthoCaseNum, name: "OrthoCaseNum"
  end

  create_table :orthoproclink, primary_key: "OrthoProcLinkNum", id: :bigint do |t|
    t.bigint   :OrthoCaseNum!
    t.bigint   :ProcNum!
    t.datetime :SecDateTEntry!  , ["0001-01-01 00:00:00"]
    t.bigint   :SecUserNumEntry!
    t.integer  :ProcLinkType!   , 1

    t.index    :OrthoCaseNum, name: "OrthoCaseNum"
    t.index    :ProcNum, name: "ProcNum"
    t.index    :SecUserNumEntry, name: "SecUserNumEntry"
  end

  create_table :orthorx, primary_key: "OrthoRxNum", id: :bigint do |t|
    t.bigint   :OrthoHardwareSpecNum!
    t.string   :Description!
    t.string   :ToothRange!
    t.integer  :ItemOrder!

    t.index    :OrthoHardwareSpecNum, name: "OrthoHardwareSpecNum"
  end

  create_table  :orthoschedule, primary_key: "OrthoScheduleNum", id: :bigint do |t|
    t.date      :BandingDateOverride!, ["0001-01-01"]
    t.date      :DebondDateOverride! , ["0001-01-01"]
    t.float     :BandingAmount!      , 53
    t.float     :VisitAmount!        , 53
    t.float     :DebondAmount!       , 53
    t.integer   :IsActive!           , 1
    t.timestamp :SecDateTEdit!       , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
  end

  create_table  :patfield, primary_key: "PatFieldNum", id: :bigint do |t|
    t.bigint    :PatNum!
    t.string    :FieldName       , [""]
    t.text      :FieldValue
    t.bigint    :SecUserNumEntry!
    t.date      :SecDateEntry!   , ["0001-01-01"]
    t.timestamp :SecDateTEdit!   , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]

    t.index     :PatNum, name: "PatNum"
    t.index     :SecUserNumEntry, name: "SecUserNumEntry"
  end

  create_table :patfielddef, primary_key: "PatFieldDefNum", id: :bigint do |t|
    t.string   :FieldName , [""]
    t.integer  :FieldType!, 1
    t.text     :PickList!
    t.integer  :ItemOrder!
    t.integer  :IsHidden! , 1
  end

  create_table  :patient, primary_key: "PatNum", id: :bigint do |t|
    t.string    :LName                     , 100, [""]
    t.string    :FName                     , 100, [""]
    t.string    :MiddleI                   , 100, [""]
    t.string    :Preferred                 , 100, [""]
    t.integer   :PatStatus!                , 1, [0], unsigned: true
    t.integer   :Gender!                   , 1, [0], unsigned: true
    t.integer   :Position!                 , 1, [0], unsigned: true
    t.date      :Birthdate!                , ["0001-01-01"]
    t.string    :SSN                       , 100, [""]
    t.string    :Address                   , 100, [""]
    t.string    :Address2                  , 100, [""]
    t.string    :City                      , 100, [""]
    t.string    :State                     , 100, [""]
    t.string    :Zip                       , 100, [""]
    t.string    :HmPhone                   , 30, [""]
    t.string    :WkPhone                   , 30, [""]
    t.string    :WirelessPhone             , 30, [""]
    t.bigint    :Guarantor!
    t.string    :CreditType                , 1, [""]
    t.string    :Email                     , 100, [""]
    t.string    :Salutation                , 100, [""]
    t.float     :EstBalance!               , 53, [0.0]
    t.bigint    :PriProv!
    t.bigint    :SecProv!
    t.bigint    :FeeSched!
    t.bigint    :BillingType!
    t.string    :ImageFolder               , 100, [""]
    t.text      :AddrNote
    t.text      :FamFinUrgNote
    t.string    :MedUrgNote                , [""]
    t.string    :ApptModNote               , [""]
    t.string    :StudentStatus             , 1, [""]
    t.string    :SchoolName!
    t.string    :ChartNumber               , 20, [""]
    t.string    :MedicaidID                , 20, [""]
    t.float     :Bal_0_30!                 , 53, [0.0]
    t.float     :Bal_31_60!                , 53, [0.0]
    t.float     :Bal_61_90!                , 53, [0.0]
    t.float     :BalOver90!                , 53, [0.0]
    t.float     :InsEst!                   , 53, [0.0]
    t.float     :BalTotal!                 , 53, [0.0]
    t.bigint    :EmployerNum!
    t.string    :EmploymentNote            , [""]
    t.string    :County                    , [""]
    t.integer   :GradeLevel!               , 1, [0]
    t.integer   :Urgency!                  , 1, [0]
    t.date      :DateFirstVisit!           , ["0001-01-01"]
    t.bigint    :ClinicNum!
    t.string    :HasIns                    , [""]
    t.string    :TrophyFolder              , [""]
    t.integer   :PlannedIsDone!            , 1, [0], unsigned: true
    t.integer   :Premed!                   , 1, unsigned: true
    t.string    :Ward                      , [""]
    t.integer   :PreferConfirmMethod!      , 1, unsigned: true
    t.integer   :PreferContactMethod!      , 1, unsigned: true
    t.integer   :PreferRecallMethod!       , 1, unsigned: true
    t.time      :SchedBeforeTime
    t.time      :SchedAfterTime
    t.integer   :SchedDayOfWeek!           , 1, unsigned: true
    t.string    :Language                  , 100, [""]
    t.date      :AdmitDate!                , ["0001-01-01"]
    t.string    :Title                     , 15
    t.float     :PayPlanDue!               , 53
    t.bigint    :SiteNum!
    t.timestamp :DateTStamp!               , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.bigint    :ResponsParty!
    t.integer   :CanadianEligibilityCode!  , 1
    t.integer   :AskToArriveEarly!
    t.integer   :PreferContactConfidential!, 1
    t.bigint    :SuperFamily!
    t.integer   :TxtMsgOk!                 , 1
    t.string    :SmokingSnoMed!            , 32
    t.string    :Country!
    t.datetime  :DateTimeDeceased!         , ["0001-01-01 00:00:00"]
    t.integer   :BillingCycleDay!          , [1]
    t.bigint    :SecUserNumEntry!
    t.date      :SecDateEntry!             , ["0001-01-01"]
    t.integer   :HasSuperBilling!          , 1
    t.bigint    :PatNumCloneFrom!
    t.bigint    :DiscountPlanNum!
    t.integer   :HasSignedTil!             , 1
    t.integer   :ShortCodeOptIn!           , 1
    t.string    :SecurityHash!

    t.index    [:Birthdate, :PatStatus], name: "BirthdateStatus"
    t.index     :ChartNumber, name: "ChartNumber"
    t.index    [:ClinicNum, :PatStatus], name: "ClinicPatStatus"
    t.index     :DiscountPlanNum, name: "DiscountPlanNum"
    t.index     :Email, name: "Email"
    t.index     :FName, name: "indexFName", 10
    t.index     :FeeSched, name: "FeeSched"
    t.index     :Guarantor, name: "indexGuarantor"
    t.index     :HmPhone, name: "HmPhone"
    t.index    [:LName, :FName], name: "indexLFName"
    t.index     :LName, name: "indexLName", 10
    t.index     :PatNumCloneFrom, name: "PatNumCloneFrom"
    t.index     :PatStatus, name: "PatStatus"
    t.index     :PriProv, name: "PriProv"
    t.index     :ResponsParty, name: "ResponsParty"
    t.index     :SecDateEntry, name: "SecDateEntry"
    t.index     :SecProv, name: "SecProv"
    t.index     :SecUserNumEntry, name: "SecUserNumEntry"
    t.index     :SiteNum, name: "SiteNum"
    t.index     :SuperFamily, name: "SuperFamily"
    t.index     :WirelessPhone, name: "WirelessPhone"
    t.index     :WkPhone, name: "WkPhone"
  end

  create_table :patientlink, primary_key: "PatientLinkNum", id: :bigint do |t|
    t.bigint   :PatNumFrom!
    t.bigint   :PatNumTo!
    t.integer  :LinkType!    , 1
    t.datetime :DateTimeLink!, ["0001-01-01 00:00:00"]

    t.index    :PatNumFrom, name: "PatNumFrom"
    t.index    :PatNumTo, name: "PatNumTo"
  end

  create_table  :patientnote, primary_key: "PatNum", id: :bigint, default: 0 do |t|
    t.text      :FamFinancial
    t.text      :ApptPhone
    t.text      :Medical
    t.text      :Service
    t.text      :MedicalComp
    t.text      :Treatment
    t.string    :ICEName!
    t.string    :ICEPhone!                  , 30
    t.integer   :OrthoMonthsTreatOverride!  , [-1]
    t.date      :DateOrthoPlacementOverride!, ["0001-01-01"]
    t.datetime  :SecDateTEntry!             , ["0001-01-01 00:00:00"]
    t.timestamp :SecDateTEdit!              , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.integer   :Consent!                   , 1
    t.bigint    :UserNumOrthoLocked!
    t.integer   :Pronoun!                   , 1

    t.index     :SecDateTEdit, name: "SecDateTEdit"
    t.index     :SecDateTEntry, name: "SecDateTEntry"
  end

  create_table :patientportalinvite, primary_key: "PatientPortalInviteNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.bigint   :ApptNum!
    t.bigint   :ClinicNum!
    t.datetime :DateTimeEntry!      , ["0001-01-01 00:00:00"]
    t.bigint   :TSPrior!
    t.integer  :SendStatus!         , 1
    t.bigint   :MessageFk!
    t.text     :ResponseDescript!
    t.integer  :MessageType!        , 1
    t.datetime :DateTimeSent!       , ["0001-01-01 00:00:00"]
    t.bigint   :ApptReminderRuleNum!
    t.datetime :ApptDateTime!       , ["0001-01-01 00:00:00"]

    t.index    :ApptNum, name: "AptNum"
    t.index    :ApptReminderRuleNum, name: "ApptReminderRuleNum"
    t.index    :ClinicNum, name: "ClinicNum"
    t.index    :MessageFk, name: "EmailMessageNum"
    t.index    :MessageFk, name: "MessageFk"
    t.index    :PatNum, name: "PatNum"
  end

  create_table :patientrace, primary_key: "PatientRaceNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.integer  :Race!      , 1
    t.string   :CdcrecCode!

    t.index    :CdcrecCode, name: "CdcrecCode"
    t.index    :PatNum, name: "PatNum"
  end

  create_table  :patplan, primary_key: "PatPlanNum", id: :bigint do |t|
    t.bigint    :PatNum!
    t.integer   :Ordinal!                   , 1, [0], unsigned: true
    t.integer   :IsPending!                 , 1, [0], unsigned: true
    t.integer   :Relationship!              , 1, [0], unsigned: true
    t.string    :PatID                      , 100, [""]
    t.bigint    :InsSubNum!
    t.float     :OrthoAutoFeeBilledOverride!, 53, [-1.0]
    t.date      :OrthoAutoNextClaimDate!    , ["0001-01-01"]
    t.datetime  :SecDateTEntry!             , ["0001-01-01 00:00:00"]
    t.timestamp :SecDateTEdit!              , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]

    t.index     :InsSubNum, name: "InsSubNum"
    t.index     :PatNum, name: "indexPatNum"
    t.index     :SecDateTEdit, name: "SecDateTEdit"
    t.index     :SecDateTEntry, name: "SecDateTEntry"
  end

  create_table :patrestriction, primary_key: "PatRestrictionNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.integer  :PatRestrictType!, 1

    t.index   [:PatNum, :PatRestrictType], name: "PatNumRestrictType"
  end

  create_table :payconnectresponseweb, primary_key: "PayConnectResponseWebNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.bigint   :PayNum!
    t.string   :AccountToken!
    t.string   :PaymentToken!
    t.string   :ProcessingStatus!
    t.datetime :DateTimeEntry!    , ["0001-01-01 00:00:00"]
    t.datetime :DateTimePending!  , ["0001-01-01 00:00:00"]
    t.datetime :DateTimeCompleted!, ["0001-01-01 00:00:00"]
    t.datetime :DateTimeExpired!  , ["0001-01-01 00:00:00"]
    t.datetime :DateTimeLastError!, ["0001-01-01 00:00:00"]
    t.text     :LastResponseStr!
    t.integer  :CCSource!         , 1
    t.float    :Amount!           , 53
    t.string   :PayNote!
    t.integer  :IsTokenSaved!     , 1
    t.string   :PayToken!
    t.string   :ExpDateToken!
    t.string   :RefNumber!
    t.string   :TransType!
    t.string   :EmailResponse!
    t.string   :LogGuid           , 36

    t.index    :PatNum, name: "PatNum"
    t.index    :PayNum, name: "PayNum"
  end

  create_table  :payment, primary_key: "PayNum", id: :bigint do |t|
    t.bigint    :PayType!
    t.date      :PayDate!
    t.float     :PayAmt!             , 53, [0.0]
    t.string    :CheckNum            , 25, [""]
    t.string    :BankBranch          , 25, [""]
    t.text      :PayNote!
    t.integer   :IsSplit!            , 1, [0], unsigned: true
    t.bigint    :PatNum!
    t.bigint    :ClinicNum!
    t.date      :DateEntry!          , ["0001-01-01"]
    t.bigint    :DepositNum!
    t.text      :Receipt!
    t.integer   :IsRecurringCC!      , 1
    t.bigint    :SecUserNumEntry!
    t.timestamp :SecDateTEdit!       , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.integer   :PaymentSource!      , 1
    t.integer   :ProcessStatus!      , 1
    t.date      :RecurringChargeDate!, ["0001-01-01"]
    t.string    :ExternalId!
    t.integer   :PaymentStatus!      , 1
    t.integer   :IsCcCompleted!      , 1

    t.index     :ClinicNum, name: "ClinicNum"
    t.index     :DepositNum, name: "DepositNum"
    t.index     :PatNum, name: "indexPatNum"
    t.index     :PayType, name: "PayType"
    t.index     :SecUserNumEntry, name: "SecUserNumEntry"
  end

  create_table :payortype, primary_key: "PayorTypeNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.date     :DateStart!, ["0001-01-01"]
    t.string   :SopCode!
    t.text     :Note!

    t.index    :PatNum, name: "PatNum"
    t.index    :SopCode, name: "SopCode"
  end

  create_table :payperiod, primary_key: "PayPeriodNum", id: :bigint do |t|
    t.date     :DateStart!   , ["0001-01-01"]
    t.date     :DateStop!    , ["0001-01-01"]
    t.date     :DatePaycheck!, ["0001-01-01"]
  end

  create_table :payplan, primary_key: "PayPlanNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.bigint   :Guarantor!
    t.date     :PayPlanDate!
    t.float    :APR!                   , 53, [0.0]
    t.text     :Note
    t.bigint   :PlanNum!
    t.float    :CompletedAmt!          , 53
    t.bigint   :InsSubNum!
    t.integer  :PaySchedule!           , 1
    t.integer  :NumberOfPayments!
    t.float    :PayAmt!                , 53
    t.float    :DownPayment!           , 53
    t.integer  :IsClosed!              , 1
    t.text     :Signature!
    t.integer  :SigIsTopaz!            , 1
    t.bigint   :PlanCategory!
    t.integer  :IsDynamic!             , 1
    t.integer  :ChargeFrequency!       , 1
    t.date     :DatePayPlanStart!      , ["0001-01-01"]
    t.integer  :IsLocked!              , 1
    t.date     :DateInterestStart!     , ["0001-01-01"]
    t.integer  :DynamicPayPlanTPOption!, 1
    t.bigint   :MobileAppDeviceNum!
    t.string   :SecurityHash!

    t.index    :Guarantor, name: "Guarantor"
    t.index    :InsSubNum, name: "InsSubNum"
    t.index    :MobileAppDeviceNum, name: "MobileAppDeviceNum"
    t.index    :PatNum, name: "PatNum"
    t.index    :PlanCategory, name: "PlanCategory"
    t.index    :PlanNum, name: "PlanNum"
  end

  create_table  :payplancharge, primary_key: "PayPlanChargeNum", id: :bigint do |t|
    t.bigint    :PayPlanNum!
    t.bigint    :Guarantor!
    t.bigint    :PatNum!
    t.date      :ChargeDate!   , ["0001-01-01"]
    t.float     :Principal!    , 53, [0.0]
    t.float     :Interest!     , 53, [0.0]
    t.text      :Note
    t.bigint    :ProvNum!
    t.bigint    :ClinicNum!
    t.integer   :ChargeType!   , 1
    t.bigint    :ProcNum!
    t.datetime  :SecDateTEntry!, ["0001-01-01 00:00:00"]
    t.timestamp :SecDateTEdit! , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.bigint    :StatementNum!
    t.bigint    :FKey!
    t.integer   :LinkType!     , 1
    t.integer   :IsOffset!     , 1

    t.index     :ClinicNum, name: "ClinicNum"
    t.index     :FKey, name: "FKey"
    t.index     :Guarantor, name: "indexGuarantor"
    t.index     :PatNum, name: "indexPatNum"
    t.index     :PayPlanNum, name: "indexPayPlanNum"
    t.index     :ProcNum, name: "ProcNum"
    t.index    [:SecDateTEdit, :PatNum], name: "SecDateTEditPN"
    t.index     :StatementNum, name: "StatementNum"
  end

  create_table :payplanlink, primary_key: "PayPlanLinkNum", id: :bigint do |t|
    t.bigint   :PayPlanNum!
    t.integer  :LinkType!      , 1
    t.bigint   :FKey!
    t.float    :AmountOverride!, 53
    t.datetime :SecDateTEntry! , ["0001-01-01 00:00:00"]

    t.index    :FKey, name: "FKey"
    t.index    :PayPlanNum, name: "PayPlanNum"
  end

  create_table  :paysplit, primary_key: "SplitNum", id: :bigint do |t|
    t.float     :SplitAmt!        , 53, [0.0]
    t.bigint    :PatNum!
    t.date      :ProcDate!
    t.bigint    :PayNum!
    t.integer   :IsDiscount!      , 1, [0], unsigned: true
    t.integer   :DiscountType!    , 1, [0], unsigned: true
    t.bigint    :ProvNum!
    t.bigint    :PayPlanNum!
    t.date      :DatePay!         , ["0001-01-01"]
    t.bigint    :ProcNum!
    t.date      :DateEntry!       , ["0001-01-01"]
    t.bigint    :UnearnedType!
    t.bigint    :ClinicNum!
    t.bigint    :SecUserNumEntry!
    t.timestamp :SecDateTEdit!    , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.bigint    :FSplitNum!
    t.bigint    :AdjNum!
    t.bigint    :PayPlanChargeNum!
    t.integer   :PayPlanDebitType!, 1
    t.string    :SecurityHash!

    t.index     :AdjNum, name: "AdjNum"
    t.index     :ClinicNum, name: "ClinicNum"
    t.index     :DatePay, name: "DatePay"
    t.index     :FSplitNum, name: "PrepaymentNum"
    t.index     :PatNum, name: "indexPatNum"
    t.index     :PayNum, name: "PayNum"
    t.index     :PayPlanChargeNum, name: "PayPlanChargeNum"
    t.index     :PayPlanNum, name: "PayPlanNum"
    t.index    [:ProcNum, :SplitAmt], name: "indexPNAmt"
    t.index     :ProcNum, name: "ProcNum"
    t.index     :ProvNum, name: "ProvNum"
    t.index    [:SecDateTEdit, :PatNum], name: "SecDateTEditPN"
    t.index     :SecUserNumEntry, name: "SecUserNumEntry"
  end

  create_table :perioexam, primary_key: "PerioExamNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.date     :ExamDate!
    t.bigint   :ProvNum!
    t.datetime :DateTMeasureEdit!, ["0001-01-01 00:00:00"]
    t.text     :Note!

    t.index    :PatNum, name: "PatNum"
  end

  create_table  :periomeasure, primary_key: "PerioMeasureNum", id: :bigint do |t|
    t.bigint    :PerioExamNum!
    t.integer   :SequenceType! , 1, [0], unsigned: true
    t.integer   :IntTooth!     , 2
    t.integer   :ToothValue!   , 2
    t.integer   :MBvalue!      , 2
    t.integer   :Bvalue!       , 2
    t.integer   :DBvalue!      , 2
    t.integer   :MLvalue!      , 2
    t.integer   :Lvalue!       , 2
    t.integer   :DLvalue!      , 2
    t.datetime  :SecDateTEntry!, ["0001-01-01 00:00:00"]
    t.timestamp :SecDateTEdit! , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]

    t.index     :PerioExamNum, name: "PerioExamNum"
    t.index     :SecDateTEdit, name: "SecDateTEdit"
    t.index     :SecDateTEntry, name: "SecDateTEntry"
  end

  create_table  :pharmacy, primary_key: "PharmacyNum", id: :bigint do |t|
    t.string    :PharmID
    t.string    :StoreName
    t.string    :Phone
    t.string    :Fax
    t.string    :Address
    t.string    :Address2
    t.string    :City
    t.string    :State
    t.string    :Zip
    t.text      :Note
    t.timestamp :DateTStamp!, [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
  end

  create_table :pharmclinic, primary_key: "PharmClinicNum", id: :bigint do |t|
    t.bigint   :PharmacyNum!
    t.bigint   :ClinicNum!

    t.index    :ClinicNum, name: "ClinicNum"
    t.index    :PharmacyNum, name: "PharmacyNum"
  end

  create_table :phonenumber, primary_key: "PhoneNumberNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.string   :PhoneNumberVal
    t.string   :PhoneNumberDigits!, 30
    t.integer  :PhoneType!        , 1

    t.index   [:PatNum, :PhoneNumberDigits], name: "PatPhoneDigits"
    t.index    :PatNum, name: "PatNum"
    t.index    :PhoneNumberDigits, name: "PhoneNumberDigits"
    t.index    :PhoneNumberVal, name: "PhoneNumberVal"
  end

  create_table :plannedappt, primary_key: "PlannedApptNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.bigint   :AptNum!
    t.integer  :ItemOrder!

    t.index    :AptNum, name: "AptNum"
    t.index    :PatNum, name: "PatNum"
  end

  create_table :popup, primary_key: "PopupNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.text     :Description
    t.boolean  :IsDisabled!
    t.integer  :PopupLevel!      , 1
    t.bigint   :UserNum!
    t.datetime :DateTimeEntry!
    t.integer  :IsArchived!      , 1
    t.bigint   :PopupNumArchive!
    t.datetime :DateTimeDisabled!, ["0001-01-01 00:00:00"]

    t.index    :PatNum, name: "PatNum"
    t.index    :PopupNumArchive, name: "PopupNumArchive"
    t.index    :UserNum, name: "UserNum"
  end

  create_table :preference, primary_key: "PrefNum", id: :bigint do |t|
    t.string   :PrefName!   , [""]
    t.text     :ValueString!
    t.text     :Comments

    t.index    :PrefName, name: "PrefName"
  end

  create_table :printer, primary_key: "PrinterNum", id: :bigint do |t|
    t.bigint   :ComputerNum!
    t.integer  :PrintSit!     , 1, [0], unsigned: true
    t.string   :PrinterName   , [""]
    t.integer  :DisplayPrompt!, 1, [0], unsigned: true
  end

  create_table :procapptcolor, primary_key: "ProcApptColorNum", id: :bigint do |t|
    t.string   :CodeRange!
    t.integer  :ColorText!
    t.integer  :ShowPreviousDate!, 1
  end

  create_table :procbutton, primary_key: "ProcButtonNum", id: :bigint do |t|
    t.string   :Description  , [""]
    t.integer  :ItemOrder!   , 2, [0], unsigned: true
    t.bigint   :Category!
    t.text     :ButtonImage
    t.integer  :IsMultiVisit!, 1
  end

  create_table :procbuttonitem, primary_key: "ProcButtonItemNum", id: :bigint do |t|
    t.bigint   :ProcButtonNum!
    t.string   :OldCode!      , 15, [""], collation: "utf8mb3_bin"
    t.bigint   :AutoCodeNum!
    t.bigint   :CodeNum!
    t.bigint   :ItemOrder!
  end

  create_table :procbuttonquick, primary_key: "ProcButtonQuickNum", id: :bigint do |t|
    t.string   :Description!
    t.string   :CodeValue!
    t.string   :Surf!
    t.integer  :YPos!
    t.integer  :ItemOrder!
    t.integer  :IsLabel!    , 1
  end

  create_table :proccodenote, primary_key: "ProcCodeNoteNum", id: :bigint do |t|
    t.bigint   :CodeNum!
    t.bigint   :ProvNum!
    t.text     :Note
    t.string   :ProcTime
    t.integer  :ProcStatus!, 1
  end

  create_table  :procedurecode, primary_key: "CodeNum", id: :bigint do |t|
    t.string    :ProcCode!          , 15, [""], collation: "utf8mb3_bin"
    t.string    :Descript           , [""]
    t.string    :AbbrDesc           , 50, [""]
    t.string    :ProcTime           , 24, [""]
    t.bigint    :ProcCat!
    t.integer   :TreatArea!         , 1, [0], unsigned: true
    t.integer   :NoBillIns!         , 1, [0], unsigned: true
    t.integer   :IsProsth!          , 1, [0], unsigned: true
    t.text      :DefaultNote
    t.integer   :IsHygiene!         , 1, [0], unsigned: true
    t.integer   :GTypeNum!          , 2, [0], unsigned: true
    t.string    :AlternateCode1     , 15, [""]
    t.string    :MedicalCode        , 15, [""], collation: "utf8mb3_bin"
    t.integer   :IsTaxed!           , 1, [0], unsigned: true
    t.integer   :PaintType!         , 1, [0]
    t.integer   :GraphicColor!
    t.string    :LaymanTerm         , [""]
    t.integer   :IsCanadianLab!     , 1, unsigned: true
    t.boolean   :PreExisting!
    t.integer   :BaseUnits!
    t.string    :SubstitutionCode   , 25
    t.integer   :SubstOnlyIf!
    t.timestamp :DateTStamp!        , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.integer   :IsMultiVisit!      , 1
    t.string    :DrugNDC!
    t.string    :RevenueCodeDefault!
    t.bigint    :ProvNumDefault!
    t.float     :CanadaTimeUnits!   , 53
    t.integer   :IsRadiology!       , 1
    t.text      :DefaultClaimNote!
    t.text      :DefaultTPNote!
    t.integer   :BypassGlobalLock!  , 1
    t.string    :TaxCode!           , 16
    t.string    :PaintText!
    t.integer   :AreaAlsoToothRange!, 1

    t.index     :ProcCode, name: "ProcCode"
    t.index     :ProvNumDefault, name: "ProvNumDefault"
  end

  create_table  :procedurelog, primary_key: "ProcNum", id: :bigint do |t|
    t.bigint    :PatNum!
    t.bigint    :AptNum!
    t.string    :OldCode!            , 15, [""], collation: "utf8mb3_bin"
    t.date      :ProcDate!           , ["0001-01-01"]
    t.float     :ProcFee!            , 53, [0.0]
    t.string    :Surf                , 10, [""]
    t.string    :ToothNum            , 2, [""]
    t.string    :ToothRange          , 100, [""]
    t.bigint    :Priority!
    t.integer   :ProcStatus!         , 1, [0], unsigned: true
    t.bigint    :ProvNum!
    t.bigint    :Dx!
    t.bigint    :PlannedAptNum!
    t.integer   :PlaceService!       , 1, [0], unsigned: true
    t.string    :Prosthesis          , 1, [""]
    t.date      :DateOriginalProsth! , ["0001-01-01"]
    t.string    :ClaimNote           , 80, [""]
    t.date      :DateEntryC!         , ["0001-01-01"]
    t.bigint    :ClinicNum!
    t.string    :MedicalCode         , 15, [""], collation: "utf8mb3_bin"
    t.string    :DiagnosticCode      , [""]
    t.integer   :IsPrincDiag!        , 1, [0], unsigned: true
    t.bigint    :ProcNumLab!
    t.bigint    :BillingTypeOne!
    t.bigint    :BillingTypeTwo!
    t.bigint    :CodeNum!
    t.string    :CodeMod1            , 2
    t.string    :CodeMod2            , 2
    t.string    :CodeMod3            , 2
    t.string    :CodeMod4            , 2
    t.string    :RevCode             , 45
    t.integer   :UnitQty!
    t.integer   :BaseUnits!
    t.integer   :StartTime!
    t.integer   :StopTime!
    t.date      :DateTP!
    t.bigint    :SiteNum!
    t.integer   :HideGraphics!       , 1
    t.string    :CanadianTypeCodes!  , 20
    t.time      :ProcTime!
    t.time      :ProcTimeEnd!
    t.timestamp :DateTStamp!         , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.bigint    :Prognosis!
    t.integer   :DrugUnit!           , 1
    t.float     :DrugQty!
    t.integer   :UnitQtyType!        , 1
    t.bigint    :StatementNum!
    t.integer   :IsLocked!           , 1
    t.string    :BillingNote!
    t.bigint    :RepeatChargeNum!
    t.string    :SnomedBodySite!
    t.string    :DiagnosticCode2!
    t.string    :DiagnosticCode3!
    t.string    :DiagnosticCode4!
    t.bigint    :ProvOrderOverride!
    t.float     :Discount!           , 53
    t.integer   :IsDateProsthEst!    , 1
    t.integer   :IcdVersion!         , 1, unsigned: true
    t.integer   :IsCpoe!             , 1
    t.bigint    :SecUserNumEntry!
    t.datetime  :SecDateEntry!       , ["0001-01-01 00:00:00"]
    t.date      :DateComplete!       , ["0001-01-01"]
    t.bigint    :OrderingReferralNum!
    t.float     :TaxAmt!             , 53
    t.integer   :Urgency!            , 1
    t.float     :DiscountPlanAmt!    , 53

    t.index    [:AptNum, :CodeNum, :ProcStatus, :IsCpoe, :ProvNum], name: "RadiologyProcs"
    t.index     :BillingTypeOne, name: "BillingTypeOne"
    t.index     :BillingTypeTwo, name: "BillingTypeTwo"
    t.index     :ClinicNum, name: "ClinicNum"
    t.index     :CodeNum, name: "CodeNum"
    t.index     :DateComplete, name: "DateComplete"
    t.index    [:DateTStamp, :PatNum], name: "DateTStampPN"
    t.index     :OrderingReferralNum, name: "OrderingReferralNum"
    t.index    [:PatNum, :ProcStatus, :ClinicNum], name: "indexPNPSCN"
    t.index    [:PatNum, :ProcStatus, :CodeNum, :ProcDate], name: "PatStatusCodeDate"
    t.index    [:PatNum, :ProcStatus, :ProcFee, :UnitQty, :BaseUnits, :ProcDate], name: "indexAgingCovering"
    t.index     :PlannedAptNum, name: "PlannedAptNum"
    t.index     :Priority, name: "Priority"
    t.index    [:ProcDate, :ClinicNum, :ProcStatus], name: "DateClinicStatus"
    t.index     :ProcNumLab, name: "procedurelog_ProcNumLab"
    t.index     :Prognosis, name: "Prognosis"
    t.index    [:ProvNum, :ProcDate], name: "indexPNPD"
    t.index     :ProvOrderOverride, name: "ProvOrderOverride"
    t.index     :RepeatChargeNum, name: "RepeatChargeNum"
    t.index     :SecUserNumEntry, name: "SecUserNumEntry"
    t.index     :StatementNum, name: "StatementNum"
  end

  create_table :procgroupitem, primary_key: "ProcGroupItemNum", id: :bigint do |t|
    t.bigint   :ProcNum!
    t.bigint   :GroupNum!

    t.index    :GroupNum, name: "GroupNum"
    t.index    :ProcNum, name: "ProcNum"
  end

  create_table  :procmultivisit, primary_key: "ProcMultiVisitNum", id: :bigint do |t|
    t.bigint    :GroupProcMultiVisitNum!
    t.bigint    :ProcNum!
    t.integer   :ProcStatus!            , 1
    t.integer   :IsInProcess!           , 1
    t.datetime  :SecDateTEntry!         , ["0001-01-01 00:00:00"]
    t.timestamp :SecDateTEdit!          , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.bigint    :PatNum!

    t.index     :GroupProcMultiVisitNum, name: "GroupProcMultiVisitNum"
    t.index     :IsInProcess, name: "IsInProcess"
    t.index     :PatNum, name: "PatNum"
    t.index     :ProcNum, name: "ProcNum"
    t.index     :SecDateTEdit, name: "SecDateTEdit"
    t.index     :SecDateTEntry, name: "SecDateTEntry"
  end

  create_table :procnote, primary_key: "ProcNoteNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.bigint   :ProcNum!
    t.datetime :EntryDateTime!, ["0001-01-01 00:00:00"]
    t.bigint   :UserNum!
    t.text     :Note
    t.integer  :SigIsTopaz!   , 1, unsigned: true
    t.text     :Signature

    t.index    :PatNum, name: "PatNum"
    t.index    :ProcNum, name: "ProcNum"
    t.index    :UserNum, name: "UserNum"
  end

  create_table  :proctp, primary_key: "ProcTPNum", id: :bigint do |t|
    t.bigint    :TreatPlanNum!
    t.bigint    :PatNum!
    t.bigint    :ProcNumOrig!
    t.integer   :ItemOrder!      , 2, [0], unsigned: true
    t.bigint    :Priority!
    t.string    :ToothNumTP      , [""]
    t.string    :Surf            , [""]
    t.string    :ProcCode        , 15
    t.string    :Descript        , [""]
    t.float     :FeeAmt!         , 53, [0.0]
    t.float     :PriInsAmt!      , 53, [0.0]
    t.float     :SecInsAmt!      , 53, [0.0]
    t.float     :PatAmt!         , 53, [0.0]
    t.float     :Discount!       , 53
    t.string    :Prognosis!
    t.string    :Dx!
    t.string    :ProcAbbr!       , 50
    t.bigint    :SecUserNumEntry!
    t.date      :SecDateEntry!   , ["0001-01-01"]
    t.timestamp :SecDateTEdit!   , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.float     :FeeAllowed!     , 53
    t.float     :TaxAmt!         , 53
    t.bigint    :ProvNum!
    t.date      :DateTP!         , ["0001-01-01"]
    t.bigint    :ClinicNum!
    t.float     :CatPercUCR!     , 53

    t.index     :ClinicNum, name: "ClinicNum"
    t.index     :PatNum, name: "indexPatNum"
    t.index     :ProcNumOrig, name: "ProcNumOrig"
    t.index     :ProvNum, name: "ProvNum"
    t.index     :SecUserNumEntry, name: "SecUserNumEntry"
    t.index     :TreatPlanNum, name: "indexTreatPlanNum"
  end

  create_table :program, primary_key: "ProgramNum", id: :bigint do |t|
    t.string   :ProgName       , 100, [""]
    t.string   :ProgDesc       , 100, [""]
    t.integer  :Enabled!       , 1, [0], unsigned: true
    t.string   :Path           , [""]
    t.string   :CommandLine    , [""]
    t.text     :Note
    t.string   :PluginDllName!
    t.text     :ButtonImage!
    t.text     :FileTemplate!
    t.string   :FilePath!
    t.integer  :IsDisabledByHq!, 1
    t.string   :CustErr!
  end

  create_table :programproperty, primary_key: "ProgramPropertyNum", id: :bigint do |t|
    t.bigint   :ProgramNum!
    t.string   :PropertyDesc   , [""]
    t.text     :PropertyValue
    t.string   :ComputerName!
    t.bigint   :ClinicNum!
    t.integer  :IsMasked!      , 1
    t.integer  :IsHighSecurity!, 1

    t.index    :ClinicNum, name: "ClinicNum"
  end

  create_table :promotion, primary_key: "PromotionNum", id: :bigint do |t|
    t.string   :PromotionName!
    t.date     :DateTimeCreated!, ["0001-01-01"]
    t.bigint   :ClinicNum!
    t.integer  :TypePromotion!  , 1

    t.index    :ClinicNum, name: "ClinicNum"
  end

  create_table :promotionlog, primary_key: "PromotionLogNum", id: :bigint do |t|
    t.bigint   :PromotionNum!
    t.bigint   :PatNum!
    t.bigint   :MessageFk!
    t.bigint   :EmailHostingFK!
    t.datetime :DateTimeSent!       , ["0001-01-01 00:00:00"]
    t.integer  :PromotionStatus!    , 1
    t.bigint   :ClinicNum!
    t.integer  :SendStatus!         , 1
    t.integer  :MessageType!        , 1
    t.datetime :DateTimeEntry!      , ["0001-01-01 00:00:00"]
    t.text     :ResponseDescript!
    t.bigint   :ApptReminderRuleNum!

    t.index    :ApptReminderRuleNum, name: "ApptReminderRuleNum"
    t.index    :ClinicNum, name: "ClinicNum"
    t.index    :EmailHostingFK, name: "EmailHostingFK"
    t.index    :MessageFk, name: "EmailMessageNum"
    t.index    :MessageFk, name: "MessageFk"
    t.index    :PatNum, name: "PatNum"
    t.index    :PromotionNum, name: "PromotionNum"
  end

  create_table  :provider, primary_key: "ProvNum", id: :bigint do |t|
    t.string    :Abbr
    t.integer   :ItemOrder!             , 2, [0], unsigned: true
    t.string    :LName                  , 100, [""]
    t.string    :FName                  , 100, [""]
    t.string    :MI                     , 100, [""]
    t.string    :Suffix                 , 100, [""]
    t.bigint    :FeeSched!
    t.bigint    :Specialty!
    t.string    :SSN                    , 12, [""]
    t.string    :StateLicense           , 15, [""]
    t.string    :DEANum                 , 15, [""]
    t.integer   :IsSecondary!           , 1, [0], unsigned: true
    t.integer   :ProvColor!             , [0]
    t.integer   :IsHidden!              , 1, [0], unsigned: true
    t.integer   :UsingTIN!              , 1, [0], unsigned: true
    t.string    :BlueCrossID            , 25, [""]
    t.integer   :SigOnFile!             , 1, [1], unsigned: true
    t.string    :MedicaidID             , 20, [""]
    t.integer   :OutlineColor!          , [0]
    t.bigint    :SchoolClassNum!
    t.string    :NationalProvID         , [""]
    t.string    :CanadianOfficeNum      , 100, [""]
    t.timestamp :DateTStamp!            , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.bigint    :AnesthProvType!
    t.string    :TaxonomyCodeOverride!
    t.integer   :IsCDAnet!              , 1
    t.string    :EcwID!
    t.string    :StateRxID!
    t.integer   :IsNotPerson!           , 1
    t.string    :StateWhereLicensed!    , 50
    t.bigint    :EmailAddressNum!
    t.integer   :IsInstructor!          , 1
    t.integer   :EhrMuStage!
    t.bigint    :ProvNumBillingOverride!
    t.string    :CustomID!
    t.integer   :ProvStatus!            , 1
    t.integer   :IsHiddenReport!        , 1
    t.integer   :IsErxEnabled!          , 1
    t.date      :Birthdate!             , ["0001-01-01"]
    t.string    :SchedNote!
    t.text      :WebSchedDescript!
    t.string    :WebSchedImageLocation!
    t.float     :HourlyProdGoalAmt!     , 53
    t.date      :DateTerm!              , ["0001-01-01"]
    t.string    :PreferredName!         , 100

    t.index     :EmailAddressNum, name: "EmailAddressNum"
    t.index     :FeeSched, name: "FeeSched"
    t.index     :ProvNumBillingOverride, name: "ProvNumBillingOverride"
  end

  create_table :providerclinic, primary_key: "ProviderClinicNum", id: :bigint do |t|
    t.bigint   :ProvNum!
    t.bigint   :ClinicNum!
    t.string   :DEANum!              , 15
    t.string   :StateLicense!        , 50
    t.string   :StateRxID!
    t.string   :StateWhereLicensed!  , 15
    t.string   :CareCreditMerchantId!, 20

    t.index    :ClinicNum, name: "ClinicNum"
    t.index    :ProvNum, name: "ProvNum"
  end

  create_table :providercliniclink, primary_key: "ProviderClinicLinkNum", id: :bigint do |t|
    t.bigint   :ProvNum!
    t.bigint   :ClinicNum!

    t.index    :ClinicNum, name: "ClinicNum"
    t.index    :ProvNum, name: "ProvNum"
  end

  create_table :providererx, primary_key: "ProviderErxNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.string   :NationalProviderID!
    t.integer  :IsEnabled!         , 1
    t.integer  :IsIdentifyProofed! , 1
    t.integer  :IsSentToHq!        , 1
    t.integer  :IsEpcs!            , 1
    t.integer  :ErxType!           , 1
    t.string   :UserId!
    t.string   :AccountId!         , 25
    t.bigint   :RegistrationKeyNum!

    t.index    :PatNum, name: "PatNum"
    t.index    :RegistrationKeyNum, name: "RegistrationKeyNum"
  end

  create_table :providerident, primary_key: "ProviderIdentNum", id: :bigint do |t|
    t.bigint   :ProvNum!
    t.string   :PayorID    , [""]
    t.integer  :SuppIDType!, 1, [0], unsigned: true
    t.string   :IDNumber   , [""]
  end

  create_table :question, primary_key: "QuestionNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.integer  :ItemOrder! , 2, unsigned: true
    t.text     :Description
    t.text     :Answer
    t.bigint   :FormPatNum!

    t.index    :PatNum, name: "indexPatNum"
  end

  create_table :questiondef, primary_key: "QuestionDefNum", id: :bigint do |t|
    t.text     :Description
    t.integer  :ItemOrder! , 2, unsigned: true
    t.integer  :QuestType! , 1, unsigned: true
  end

  create_table :quickpastecat, primary_key: "QuickPasteCatNum", id: :bigint do |t|
    t.string   :Description    , [""]
    t.integer  :ItemOrder!     , 2, [0], unsigned: true
    t.text     :DefaultForTypes
  end

  create_table :quickpastenote, primary_key: "QuickPasteNoteNum", id: :bigint do |t|
    t.bigint   :QuickPasteCatNum!
    t.integer  :ItemOrder!       , 2, [0], unsigned: true
    t.text     :Note
    t.string   :Abbreviation     , [""]
  end

  create_table :reactivation, primary_key: "ReactivationNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.bigint   :ReactivationStatus!
    t.text     :ReactivationNote!
    t.integer  :DoNotContact!      , 1

    t.index    :PatNum, name: "PatNum"
    t.index    :ReactivationStatus, name: "ReactivationStatus"
  end

  create_table  :recall, primary_key: "RecallNum", id: :bigint do |t|
    t.bigint    :PatNum!
    t.date      :DateDueCalc!        , ["0001-01-01"]
    t.date      :DateDue!            , ["0001-01-01"]
    t.date      :DatePrevious!       , ["0001-01-01"]
    t.integer   :RecallInterval!     , [0]
    t.bigint    :RecallStatus!
    t.text      :Note
    t.integer   :IsDisabled!         , 1, [0], unsigned: true
    t.timestamp :DateTStamp!         , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.bigint    :RecallTypeNum!
    t.float     :DisableUntilBalance!, 53
    t.date      :DisableUntilDate!   , ["0001-01-01"]
    t.date      :DateScheduled!      , ["0001-01-01"]
    t.integer   :Priority!           , 1
    t.string    :TimePatternOverride!

    t.index    [:DateDue, :IsDisabled, :RecallTypeNum, :DateScheduled], name: "DateDisabledType"
    t.index     :DatePrevious, name: "DatePrevious"
    t.index     :DateScheduled, name: "DateScheduled"
    t.index     :IsDisabled, name: "IsDisabled"
    t.index     :PatNum, name: "PatNum"
    t.index     :RecallTypeNum, name: "RecallTypeNum"
  end

  create_table :recalltrigger, primary_key: "RecallTriggerNum", id: :bigint do |t|
    t.bigint   :RecallTypeNum!
    t.bigint   :CodeNum!

    t.index    :CodeNum, name: "CodeNum"
    t.index    :RecallTypeNum, name: "RecallTypeNum"
  end

  create_table :recalltype, primary_key: "RecallTypeNum", id: :bigint do |t|
    t.string   :Description
    t.integer  :DefaultInterval!
    t.string   :TimePattern
    t.string   :Procedures
    t.integer  :AppendToSpecial!, 1
  end

  create_table :reconcile, primary_key: "ReconcileNum", id: :bigint do |t|
    t.bigint   :AccountNum!
    t.float    :StartingBal!  , 53, [0.0]
    t.float    :EndingBal!    , 53, [0.0]
    t.date     :DateReconcile!, ["0001-01-01"]
    t.integer  :IsLocked!     , 1, [0], unsigned: true
  end

  create_table :recurringcharge, primary_key: "RecurringChargeNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.bigint   :ClinicNum!
    t.datetime :DateTimeCharge!, ["0001-01-01 00:00:00"]
    t.integer  :ChargeStatus!  , 1
    t.float    :FamBal!        , 53
    t.float    :PayPlanDue!    , 53
    t.float    :TotalDue!      , 53
    t.float    :RepeatAmt!     , 53
    t.float    :ChargeAmt!     , 53
    t.bigint   :UserNum!
    t.bigint   :PayNum!
    t.bigint   :CreditCardNum!
    t.text     :ErrorMsg!

    t.index    :ClinicNum, name: "ClinicNum"
    t.index    :CreditCardNum, name: "CreditCardNum"
    t.index    :PatNum, name: "PatNum"
    t.index    :PayNum, name: "PayNum"
    t.index    :UserNum, name: "UserNum"
  end

  create_table  :refattach, primary_key: "RefAttachNum", id: :bigint do |t|
    t.bigint    :ReferralNum!
    t.bigint    :PatNum!
    t.integer   :ItemOrder!         , 2, [0], unsigned: true
    t.date      :RefDate!
    t.integer   :RefType!           , 1
    t.integer   :RefToStatus!       , 1, unsigned: true
    t.text      :Note
    t.integer   :IsTransitionOfCare!, 1
    t.bigint    :ProcNum!
    t.date      :DateProcComplete!  , ["0001-01-01"]
    t.bigint    :ProvNum!
    t.timestamp :DateTStamp!        , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]

    t.index     :PatNum, name: "PatNum"
    t.index     :ProcNum, name: "ProcNum"
    t.index     :ProvNum, name: "ProvNum"
    t.index     :ReferralNum, name: "ReferralNum"
  end

  create_table  :referral, primary_key: "ReferralNum", id: :bigint do |t|
    t.string    :LName           , 100, [""]
    t.string    :FName           , 100, [""]
    t.string    :MName           , 100, [""]
    t.string    :SSN             , 9, [""]
    t.integer   :UsingTIN!       , 1, [0], unsigned: true
    t.bigint    :Specialty!
    t.string    :ST              , 2, [""]
    t.string    :Telephone       , 10, [""]
    t.string    :Address         , 100, [""]
    t.string    :Address2        , 100, [""]
    t.string    :City            , 100, [""]
    t.string    :Zip             , 10, [""]
    t.text      :Note
    t.string    :Phone2          , 30, [""]
    t.integer   :IsHidden!       , 1, [0], unsigned: true
    t.integer   :NotPerson!      , 1, [0], unsigned: true
    t.string    :Title           , [""]
    t.string    :EMail           , [""]
    t.bigint    :PatNum!
    t.string    :NationalProvID
    t.bigint    :Slip!
    t.integer   :IsDoctor!       , 1
    t.integer   :IsTrustedDirect!, 1
    t.timestamp :DateTStamp!     , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.integer   :IsPreferred!    , 1
    t.string    :BusinessName!
    t.string    :DisplayNote!    , 4000
  end

  create_table :referralcliniclink, primary_key: "ReferralClinicLinkNum", id: :bigint do |t|
    t.bigint   :ReferralNum!
    t.bigint   :ClinicNum!

    t.index    :ClinicNum, name: "ClinicNum"
    t.index    :ReferralNum, name: "ReferralNum"
  end

  create_table :registrationkey, primary_key: "RegistrationKeyNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.string   :RegKey               , 4000
    t.string   :Note                 , 4000
    t.date     :DateStarted!
    t.date     :DateDisabled!
    t.date     :DateEnded!
    t.boolean  :IsForeign!
    t.integer  :UsesServerVersion!   , 1
    t.integer  :IsFreeVersion!       , 1
    t.integer  :IsOnlyForTesting!    , 1
    t.integer  :VotesAllotted!
    t.integer  :IsResellerCustomer!  , 1
    t.integer  :HasEarlyAccess!      , 1
    t.datetime :DateTBackupScheduled!, ["0001-01-01 00:00:00"]
    t.string   :BackupPassCode!      , 32

    t.index    :PatNum, name: "PatNum"
  end

  create_table :reminderrule, primary_key: "ReminderRuleNum", id: :bigint do |t|
    t.integer  :ReminderCriterion!, 1
    t.bigint   :CriterionFK!
    t.string   :CriterionValue!
    t.string   :Message!

    t.index    :CriterionFK, name: "CriterionFK"
  end

  create_table :repeatcharge, primary_key: "RepeatChargeNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.string   :ProcCode       , 15
    t.float    :ChargeAmt!     , 53, [0.0]
    t.date     :DateStart!     , ["0001-01-01"]
    t.date     :DateStop!      , ["0001-01-01"]
    t.text     :Note
    t.integer  :CopyNoteToProc!, 1
    t.integer  :CreatesClaim!  , 1
    t.integer  :IsEnabled!     , 1
    t.integer  :UsePrepay!     , 1
    t.text     :Npi!
    t.text     :ErxAccountId!
    t.text     :ProviderName!
    t.float    :ChargeAmtAlt!  , 53
    t.string   :UnearnedTypes! , 4000

    t.index    :PatNum, name: "PatNum"
  end

  create_table :replicationserver, primary_key: "ReplicationServerNum", id: :bigint do |t|
    t.text     :Descript!
    t.integer  :ServerId!     , unsigned: true
    t.bigint   :RangeStart!
    t.bigint   :RangeEnd!
    t.string   :AtoZpath!
    t.integer  :UpdateBlocked!, 1
    t.string   :SlaveMonitor!
  end

  create_table :reqneeded, primary_key: "ReqNeededNum", id: :bigint do |t|
    t.string   :Descript
    t.bigint   :SchoolCourseNum!
    t.bigint   :SchoolClassNum!
  end

  create_table :reqstudent, primary_key: "ReqStudentNum", id: :bigint do |t|
    t.bigint   :ReqNeededNum!
    t.string   :Descript
    t.bigint   :SchoolCourseNum!
    t.bigint   :ProvNum!
    t.bigint   :AptNum!
    t.bigint   :PatNum!
    t.bigint   :InstructorNum!
    t.date     :DateCompleted!  , ["0001-01-01"]

    t.index    :ProvNum, name: "ProvNum"
    t.index    :ReqNeededNum, name: "ReqNeededNum"
  end

  create_table :requiredfield, primary_key: "RequiredFieldNum", id: :bigint do |t|
    t.integer  :FieldType!, 1
    t.string   :FieldName!, 50
  end

  create_table :requiredfieldcondition, primary_key: "RequiredFieldConditionNum", id: :bigint do |t|
    t.bigint   :RequiredFieldNum!
    t.string   :ConditionType!        , 50
    t.integer  :Operator!             , 1
    t.string   :ConditionValue!
    t.integer  :ConditionRelationship!, 1

    t.index    :RequiredFieldNum, name: "RequiredFieldNum"
  end

  create_table :reseller, primary_key: "ResellerNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.string   :UserName!
    t.string   :ResellerPassword!
    t.bigint   :BillingType!
    t.integer  :VotesAllotted!
    t.string   :Note!            , 4000

    t.index    :BillingType, name: "BillingType"
    t.index    :PatNum, name: "PatNum"
  end

  create_table :resellerservice, primary_key: "ResellerServiceNum", id: :bigint do |t|
    t.bigint   :ResellerNum!
    t.bigint   :CodeNum!
    t.float    :Fee!        , 53
    t.string   :HostedUrl

    t.index    :CodeNum, name: "CodeNum"
    t.index    :ResellerNum, name: "ResellerNum"
  end

  create_table :rxalert, primary_key: "RxAlertNum", id: :bigint do |t|
    t.bigint   :RxDefNum!
    t.bigint   :DiseaseDefNum!
    t.bigint   :AllergyDefNum!
    t.bigint   :MedicationNum!
    t.string   :NotificationMsg!
    t.integer  :IsHighSignificance!, 1

    t.index    :AllergyDefNum, name: "AllergyDefNum"
    t.index    :MedicationNum, name: "MedicationNum"
  end

  create_table :rxdef, primary_key: "RxDefNum", id: :bigint do |t|
    t.string   :Drug               , [""]
    t.string   :Sig                , [""]
    t.string   :Disp               , [""]
    t.string   :Refills            , 30, [""]
    t.string   :Notes              , [""]
    t.integer  :IsControlled!      , 1
    t.bigint   :RxCui!
    t.integer  :IsProcRequired!    , 1
    t.text     :PatientInstruction!

    t.index    :RxCui, name: "RxCui"
  end

  create_table :rxnorm, primary_key: "RxNormNum", id: :bigint do |t|
    t.string   :RxCui!
    t.string   :MmslCode!
    t.text     :Description!

    t.index    :RxCui, name: "RxCui"
  end

  create_table  :rxpat, primary_key: "RxNum", id: :bigint do |t|
    t.bigint    :PatNum!
    t.date      :RxDate!
    t.string    :Drug               , [""]
    t.string    :Sig                , [""]
    t.string    :Disp               , [""]
    t.string    :Refills            , 30, [""]
    t.bigint    :ProvNum!
    t.string    :Notes              , [""]
    t.bigint    :PharmacyNum!
    t.integer   :IsControlled!      , 1
    t.timestamp :DateTStamp!        , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.integer   :SendStatus!        , 1
    t.bigint    :RxCui!
    t.string    :DosageCode!
    t.string    :ErxGuid!           , 40
    t.integer   :IsErxOld!          , 1
    t.string    :ErxPharmacyInfo!
    t.integer   :IsProcRequired!    , 1
    t.bigint    :ProcNum!
    t.float     :DaysOfSupply       , 53
    t.text      :PatientInstruction!
    t.bigint    :ClinicNum!
    t.bigint    :UserNum!
    t.integer   :RxType!            , 1

    t.index     :ClinicNum, name: "ClinicNum"
    t.index    [:PatNum, :RxType], name: "PatNumRxType"
    t.index     :ProcNum, name: "ProcNum"
    t.index     :ProvNum, name: "ProvNum"
    t.index     :RxCui, name: "RxCui"
    t.index     :UserNum, name: "UserNum"
  end

  create_table  :schedule, primary_key: "ScheduleNum", id: :bigint do |t|
    t.date      :SchedDate!
    t.time      :StartTime!   , ["2000-01-01 00:00:00"]
    t.time      :StopTime!    , ["2000-01-01 00:00:00"]
    t.integer   :SchedType!   , 1, [0], unsigned: true
    t.bigint    :ProvNum!
    t.bigint    :BlockoutType!
    t.text      :Note
    t.integer   :Status!      , 1, [0], unsigned: true
    t.bigint    :EmployeeNum!
    t.timestamp :DateTStamp!  , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.bigint    :ClinicNum!

    t.index     :BlockoutType, name: "BlockoutType"
    t.index    [:ClinicNum, :SchedType], name: "ClinicNumSchedType"
    t.index    [:EmployeeNum, :SchedDate, :SchedType, :StopTime], name: "EmpDateTypeStopTime"
    t.index     :ProvNum, name: "ProvNum"
    t.index     :SchedDate, name: "SchedDate"
  end

  create_table :scheduledprocess, primary_key: "ScheduledProcessNum", id: :bigint do |t|
    t.string   :ScheduledAction!, 50
    t.datetime :TimeToRun!      , ["0001-01-01 00:00:00"]
    t.string   :FrequencyToRun! , 50
    t.datetime :LastRanDateTime!, ["0001-01-01 00:00:00"]
  end

  create_table :scheduleop, primary_key: "ScheduleOpNum", id: :bigint do |t|
    t.bigint   :ScheduleNum!
    t.bigint   :OperatoryNum!

    t.index    :OperatoryNum, name: "OperatoryNum"
    t.index    :ScheduleNum, name: "ScheduleNum"
  end

  create_table :schoolclass, primary_key: "SchoolClassNum", id: :bigint do |t|
    t.integer  :GradYear!
    t.string   :Descript , [""]
  end

  create_table :schoolcourse, primary_key: "SchoolCourseNum", id: :bigint do |t|
    t.string   :CourseID, [""]
    t.string   :Descript, [""]
  end

  create_table :screen, primary_key: "ScreenNum", id: :bigint do |t|
    t.integer  :Gender!          , 1, [0], unsigned: true
    t.integer  :RaceOld!         , 1
    t.integer  :GradeLevel!      , 1, [0]
    t.integer  :Age!             , 1, [0], unsigned: true
    t.integer  :Urgency!         , 1, [0]
    t.integer  :HasCaries!       , 1, [0], unsigned: true
    t.integer  :NeedsSealants!   , 1, [0], unsigned: true
    t.integer  :CariesExperience!, 1, [0], unsigned: true
    t.integer  :EarlyChildCaries!, 1, [0], unsigned: true
    t.integer  :ExistingSealants!, 1, [0], unsigned: true
    t.integer  :MissingAllTeeth! , 1, [0], unsigned: true
    t.date     :Birthdate!
    t.bigint   :ScreenGroupNum!
    t.integer  :ScreenGroupOrder!, 2, [0], unsigned: true
    t.string   :Comments
    t.bigint   :ScreenPatNum!
    t.bigint   :SheetNum!

    t.index    :ScreenPatNum, name: "ScreenPatNum"
    t.index    :SheetNum, name: "SheetNum"
  end

  create_table :screengroup, primary_key: "ScreenGroupNum", id: :bigint do |t|
    t.string   :Description  , [""]
    t.date     :SGDate!
    t.string   :ProvName!
    t.bigint   :ProvNum!
    t.integer  :PlaceService!, 1
    t.string   :County!
    t.string   :GradeSchool!
    t.bigint   :SheetDefNum!

    t.index    :ProvNum, name: "ProvNum"
    t.index    :SheetDefNum, name: "SheetDefNum"
  end

  create_table :screenpat, primary_key: "ScreenPatNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.bigint   :ScreenGroupNum!
    t.bigint   :SheetNum!
    t.integer  :PatScreenPerm! , 1

    t.index    :PatNum, name: "PatNum"
    t.index    :ScreenGroupNum, name: "ScreenGroupNum"
    t.index    :SheetNum, name: "SheetNum"
  end

  create_table :securitylog, primary_key: "SecurityLogNum", id: :bigint do |t|
    t.integer  :PermType!     , 1, [0], unsigned: true
    t.bigint   :UserNum!
    t.datetime :LogDateTime!
    t.text     :LogText
    t.bigint   :PatNum!
    t.string   :CompName!
    t.bigint   :FKey!
    t.integer  :LogSource!    , 1
    t.bigint   :DefNum!
    t.bigint   :DefNumError!
    t.datetime :DateTPrevious!, ["0001-01-01 00:00:00"]

    t.index    :DefNum, name: "DefNum"
    t.index    :DefNumError, name: "DefNumError"
    t.index    :FKey, name: "FKey"
    t.index    :LogDateTime, name: "LogDateTime"
    t.index    :PatNum, name: "PatNum"
    t.index    :PermType, name: "PermType"
    t.index    :UserNum, name: "UserNum"
  end

  create_table :securityloghash, primary_key: "SecurityLogHashNum", id: :bigint do |t|
    t.bigint   :SecurityLogNum!
    t.string   :LogHash!

    t.index    :SecurityLogNum, name: "SecurityLogNum"
  end

  create_table :sessiontoken, primary_key: "SessionTokenNum", id: :bigint do |t|
    t.string   :SessionTokenHash!
    t.datetime :Expiration!      , ["0001-01-01 00:00:00"]
    t.integer  :TokenType!       , 1
    t.bigint   :FKey!

    t.index    :Expiration, name: "Expiration"
    t.index    :FKey, name: "FKey"
    t.index    :SessionTokenHash, name: "SessionTokenHash", 20
  end

  create_table :sheet, primary_key: "SheetNum", id: :bigint do |t|
    t.integer  :SheetType!
    t.bigint   :PatNum!
    t.datetime :DateTimeSheet!   , ["0001-01-01 00:00:00"]
    t.float    :FontSize!
    t.string   :FontName
    t.integer  :Width!
    t.integer  :Height!
    t.integer  :IsLandscape!     , 1
    t.text     :InternalNote
    t.string   :Description!
    t.integer  :ShowInTerminal!  , 1
    t.integer  :IsWebForm!       , 1
    t.integer  :IsMultiPage!     , 1
    t.integer  :IsDeleted!       , 1
    t.bigint   :SheetDefNum!
    t.bigint   :DocNum!
    t.bigint   :ClinicNum!
    t.datetime :DateTSheetEdited!, ["0001-01-01 00:00:00"]
    t.integer  :HasMobileLayout! , 1
    t.integer  :RevID!

    t.index    :ClinicNum, name: "ClinicNum"
    t.index    :DocNum, name: "DocNum"
    t.index    :PatNum, name: "PatNum"
    t.index    :SheetDefNum, name: "SheetDefNum"
  end

  create_table :sheetdef, primary_key: "SheetDefNum", id: :bigint do |t|
    t.string   :Description
    t.integer  :SheetType!
    t.float    :FontSize!
    t.string   :FontName
    t.integer  :Width!
    t.integer  :Height!
    t.integer  :IsLandscape!       , 1
    t.integer  :PageCount!
    t.integer  :IsMultiPage!       , 1
    t.integer  :BypassGlobalLock!  , 1
    t.integer  :HasMobileLayout!   , 1
    t.datetime :DateTCreated!      , ["0001-01-01 00:00:00"]
    t.integer  :RevID!
    t.integer  :AutoCheckSaveImage!, 1, [1]
  end

  create_table :sheetfield, primary_key: "SheetFieldNum", id: :bigint do |t|
    t.bigint   :SheetNum!
    t.integer  :FieldType!
    t.string   :FieldName
    t.text     :FieldValue
    t.float    :FontSize!
    t.string   :FontName
    t.integer  :FontIsBold!              , 1
    t.integer  :XPos!
    t.integer  :YPos!
    t.integer  :Width!
    t.integer  :Height!
    t.integer  :GrowthBehavior!
    t.string   :RadioButtonValue!
    t.string   :RadioButtonGroup!
    t.integer  :IsRequired!              , 1
    t.integer  :TabOrder!
    t.string   :ReportableName
    t.integer  :TextAlign!               , 1
    t.integer  :ItemColor!               , [-16777216]
    t.datetime :DateTimeSig!             , ["0001-01-01 00:00:00"]
    t.integer  :IsLocked!                , 1
    t.integer  :TabOrderMobile!
    t.text     :UiLabelMobile!
    t.text     :UiLabelMobileRadioButton!
    t.bigint   :SheetFieldDefNum!
    t.integer  :CanElectronicallySign!   , 1
    t.integer  :IsSigProvRestricted!     , 1

    t.index    :FieldType, name: "FieldType"
    t.index    :SheetFieldDefNum, name: "SheetFieldDefNum"
    t.index   [:SheetNum, :FieldType], name: "SheetNumFieldType"
    t.index    :SheetNum, name: "SheetNum"
  end

  create_table :sheetfielddef, primary_key: "SheetFieldDefNum", id: :bigint do |t|
    t.bigint   :SheetDefNum!
    t.integer  :FieldType!
    t.string   :FieldName
    t.text     :FieldValue!
    t.float    :FontSize!
    t.string   :FontName
    t.integer  :FontIsBold!              , 1
    t.integer  :XPos!
    t.integer  :YPos!
    t.integer  :Width!
    t.integer  :Height!
    t.integer  :GrowthBehavior!
    t.string   :RadioButtonValue!
    t.string   :RadioButtonGroup!
    t.integer  :IsRequired!              , 1
    t.integer  :TabOrder!
    t.string   :ReportableName
    t.integer  :TextAlign!               , 1
    t.integer  :IsPaymentOption!         , 1
    t.integer  :ItemColor!               , [-16777216]
    t.integer  :IsLocked!                , 1
    t.integer  :TabOrderMobile!
    t.text     :UiLabelMobile!
    t.text     :UiLabelMobileRadioButton!
    t.integer  :LayoutMode!              , 1
    t.string   :Language!
    t.integer  :CanElectronicallySign!   , 1
    t.integer  :IsSigProvRestricted!     , 1

    t.index    :SheetDefNum, name: "SheetDefNum"
  end

  create_table :sigbutdef, primary_key: "SigButDefNum", id: :bigint do |t|
    t.string   :ButtonText            , [""]
    t.integer  :ButtonIndex!          , 2
    t.integer  :SynchIcon!            , 1, unsigned: true
    t.string   :ComputerName          , [""]
    t.bigint   :SigElementDefNumUser!
    t.bigint   :SigElementDefNumExtra!
    t.bigint   :SigElementDefNumMsg!

    t.index    :SigElementDefNumExtra, name: "SigElementDefNumExtra"
    t.index    :SigElementDefNumMsg, name: "SigElementDefNumMsg"
    t.index    :SigElementDefNumUser, name: "SigElementDefNumUser"
  end

  create_table :sigelementdef, primary_key: "SigElementDefNum", id: :bigint do |t|
    t.integer  :LightRow!      , 1, unsigned: true
    t.integer  :LightColor!
    t.integer  :SigElementType!, 1, unsigned: true
    t.string   :SigText        , [""]
    t.text     :Sound          , size: :medium
    t.integer  :ItemOrder!     , 2
  end

  create_table :sigmessage, primary_key: "SigMessageNum", id: :bigint do |t|
    t.string   :ButtonText!
    t.integer  :ButtonIndex!
    t.integer  :SynchIcon!            , 1, unsigned: true
    t.string   :FromUser!
    t.string   :ToUser!
    t.datetime :MessageDateTime!      , ["0001-01-01 00:00:00"]
    t.datetime :AckDateTime!          , ["0001-01-01 00:00:00"]
    t.string   :SigText!
    t.bigint   :SigElementDefNumUser!
    t.bigint   :SigElementDefNumExtra!
    t.bigint   :SigElementDefNumMsg!

    t.index    :SigElementDefNumExtra, name: "SigElementDefNumExtra"
    t.index    :SigElementDefNumMsg, name: "SigElementDefNumMsg"
    t.index    :SigElementDefNumUser, name: "SigElementDefNumUser"
  end

  create_table :signalod, primary_key: "SignalNum", id: :bigint do |t|
    t.date     :DateViewing!, ["0001-01-01"]
    t.datetime :SigDateTime!, ["0001-01-01 00:00:00"]
    t.bigint   :FKey!
    t.string   :FKeyType!
    t.integer  :IType!      , 1
    t.integer  :RemoteRole! , 1
    t.text     :MsgValue!

    t.index    :FKey, name: "FKey"
    t.index    :IType, name: "IType"
    t.index    :SigDateTime, name: "indexSigDateTime"
  end

  create_table :site, primary_key: "SiteNum", id: :bigint do |t|
    t.string   :Description
    t.text     :Note
    t.string   :Address!     , 100
    t.string   :Address2!    , 100
    t.string   :City!        , 100
    t.string   :State!       , 100
    t.string   :Zip!         , 100
    t.bigint   :ProvNum!
    t.integer  :PlaceService!, 1

    t.index    :ProvNum, name: "ProvNum"
  end

  create_table :smsblockphone, primary_key: "SmsBlockPhoneNum", id: :bigint do |t|
    t.string   :BlockWirelessNumber!
  end

  create_table  :smsfrommobile, primary_key: "SmsFromMobileNum", id: :bigint do |t|
    t.bigint    :PatNum!
    t.bigint    :ClinicNum!
    t.bigint    :CommlogNum!
    t.text      :MsgText!
    t.datetime  :DateTimeReceived! , ["0001-01-01 00:00:00"]
    t.string    :SmsPhoneNumber!
    t.string    :MobilePhoneNumber!
    t.integer   :MsgPart!
    t.integer   :MsgTotal!
    t.string    :MsgRefID!
    t.integer   :SmsStatus!        , 1
    t.string    :Flags!
    t.integer   :IsHidden!         , 1
    t.integer   :MatchCount!
    t.string    :GuidMessage!
    t.timestamp :SecDateTEdit!     , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]

    t.index     :CommlogNum, name: "CommlogNum"
    t.index     :PatNum, name: "PatNum"
    t.index     :SecDateTEdit, name: "SecDateTEdit"
    t.index    [:SmsStatus, :IsHidden, :ClinicNum], name: "StatusHiddenClinic"
  end

  create_table :smsphone, primary_key: "SmsPhoneNum", id: :bigint do |t|
    t.bigint   :ClinicNum!
    t.string   :PhoneNumber!
    t.datetime :DateTimeActive!  , ["0001-01-01 00:00:00"]
    t.datetime :DateTimeInactive!, ["0001-01-01 00:00:00"]
    t.string   :InactiveCode!
    t.string   :CountryCode!

    t.index    :ClinicNum, name: "ClinicNum"
  end

  create_table  :smstomobile, primary_key: "SmsToMobileNum", id: :bigint do |t|
    t.bigint    :PatNum!
    t.string    :GuidMessage!
    t.string    :GuidBatch!
    t.string    :SmsPhoneNumber!
    t.string    :MobilePhoneNumber!
    t.integer   :IsTimeSensitive!   , 1
    t.integer   :MsgType!           , 1
    t.text      :MsgText!
    t.integer   :SmsStatus!         , 1
    t.integer   :MsgParts!
    t.float     :MsgChargeUSD!
    t.bigint    :ClinicNum!
    t.string    :CustErrorText!
    t.datetime  :DateTimeSent!      , ["0001-01-01 00:00:00"]
    t.datetime  :DateTimeTerminated!, ["0001-01-01 00:00:00"]
    t.integer   :IsHidden!          , 1
    t.float     :MsgDiscountUSD!
    t.timestamp :SecDateTEdit!      , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]

    t.index    [:ClinicNum, :DateTimeSent], name: "ClinicDTSent"
    t.index     :GuidMessage, name: "GuidMessage"
    t.index     :PatNum, name: "PatNum"
    t.index     :SecDateTEdit, name: "SecDateTEdit"
  end

  create_table :snomed, primary_key: "SnomedNum", id: :bigint do |t|
    t.string   :SnomedCode!
    t.string   :Description!

    t.index    :SnomedCode, name: "SnomedCode"
  end

  create_table :sop, primary_key: "SopNum", id: :bigint do |t|
    t.string   :SopCode!
    t.string   :Description!

    t.index    :SopCode, name: "SopCode"
  end

  create_table :stateabbr, primary_key: "StateAbbrNum", id: :bigint do |t|
    t.string   :Description!     , 50
    t.string   :Abbr!            , 50
    t.integer  :MedicaidIDLength!
  end

  create_table  :statement, primary_key: "StatementNum", id: :bigint do |t|
    t.bigint    :PatNum!
    t.date      :DateSent!
    t.date      :DateRangeFrom!
    t.date      :DateRangeTo!
    t.text      :Note
    t.text      :NoteBold
    t.integer   :Mode_!            , 1, unsigned: true
    t.boolean   :HidePayment!
    t.boolean   :SinglePatient!
    t.boolean   :Intermingled!
    t.boolean   :IsSent!
    t.bigint    :DocNum!
    t.timestamp :DateTStamp!       , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.integer   :IsReceipt!        , 1
    t.integer   :IsInvoice!        , 1
    t.integer   :IsInvoiceCopy!    , 1
    t.string    :EmailSubject!
    t.text      :EmailBody!        , size: :medium
    t.bigint    :SuperFamily!
    t.integer   :IsBalValid!       , 1
    t.float     :InsEst!           , 53
    t.float     :BalTotal!         , 53
    t.string    :StatementType!    , 50
    t.string    :ShortGUID!        , 30
    t.string    :StatementShortURL!, 50
    t.string    :StatementURL!
    t.integer   :SmsSendStatus!    , 1

    t.index     :DocNum, name: "DocNum"
    t.index     :IsSent, name: "IsSent"
    t.index     :PatNum, name: "PatNum"
    t.index     :ShortGUID, name: "ShortGUID"
    t.index    [:SuperFamily, :Mode_, :DateSent], name: "SuperFamModeDateSent"
  end

  create_table :statementprod, primary_key: "StatementProdNum", id: :bigint do |t|
    t.bigint   :StatementNum!
    t.bigint   :FKey!
    t.integer  :ProdType!        , 1
    t.bigint   :LateChargeAdjNum!
    t.bigint   :DocNum!

    t.index    :DocNum, name: "DocNum"
    t.index    :FKey, name: "FKey"
    t.index    :LateChargeAdjNum, name: "LateChargeAdjNum"
    t.index    :ProdType, name: "ProdType"
    t.index    :StatementNum, name: "StatementNum"
  end

  create_table :stmtlink, primary_key: "StmtLinkNum", id: :bigint do |t|
    t.bigint   :StatementNum!
    t.integer  :StmtLinkType!, 1
    t.bigint   :FKey!

    t.index    :StatementNum, name: "StatementNum"
    t.index   [:StmtLinkType, :FKey], name: "FKeyAndType"
  end

  create_table :substitutionlink, primary_key: "SubstitutionLinkNum", id: :bigint do |t|
    t.bigint   :PlanNum!
    t.bigint   :CodeNum!
    t.string   :SubstitutionCode!, 25
    t.integer  :SubstOnlyIf!

    t.index    :CodeNum, name: "CodeNum"
    t.index    :PlanNum, name: "PlanNum"
  end

  create_table :supplier, primary_key: "SupplierNum", id: :bigint do |t|
    t.string   :Name
    t.string   :Phone
    t.string   :CustomerId
    t.text     :Website
    t.string   :UserName
    t.string   :Password
    t.text     :Note
  end

  create_table :supply, primary_key: "SupplyNum", id: :bigint do |t|
    t.bigint   :SupplierNum!
    t.string   :CatalogNumber
    t.string   :Descript
    t.bigint   :Category!
    t.integer  :ItemOrder!
    t.float    :LevelDesired!
    t.boolean  :IsHidden!
    t.float    :Price!           , 53
    t.string   :BarCodeOrID!
    t.float    :DispDefaultQuant!
    t.integer  :DispUnitsCount!
    t.string   :DispUnitDesc!
    t.float    :LevelOnHand!
    t.integer  :OrderQty!

    t.index    :SupplierNum, name: "SupplierNum"
  end

  create_table :supplyneeded, primary_key: "SupplyNeededNum", id: :bigint do |t|
    t.text     :Description
    t.date     :DateAdded!
  end

  create_table :supplyorder, primary_key: "SupplyOrderNum", id: :bigint do |t|
    t.bigint   :SupplierNum!
    t.date     :DatePlaced!
    t.text     :Note
    t.float    :AmountTotal!   , 53
    t.bigint   :UserNum!
    t.float    :ShippingCharge!, 53
    t.date     :DateReceived!  , ["0001-01-01"]

    t.index    :SupplierNum, name: "SupplierNum"
    t.index    :UserNum, name: "UserNum"
  end

  create_table :supplyorderitem, primary_key: "SupplyOrderItemNum", id: :bigint do |t|
    t.bigint   :SupplyOrderNum!
    t.bigint   :SupplyNum!
    t.integer  :Qty!
    t.float    :Price!         , 53

    t.index    :SupplyNum, name: "SupplyNum"
    t.index    :SupplyOrderNum, name: "SupplyOrderNum"
  end

  create_table  :task, primary_key: "TaskNum", id: :bigint do |t|
    t.bigint    :TaskListNum!
    t.date      :DateTask!         , ["0001-01-01"]
    t.bigint    :KeyNum!
    t.text      :Descript
    t.integer   :TaskStatus!       , 1, [0], unsigned: true
    t.integer   :IsRepeating!      , 1, [0], unsigned: true
    t.integer   :DateType!         , 1, [0], unsigned: true
    t.bigint    :FromNum!
    t.integer   :ObjectType!       , 1, [0], unsigned: true
    t.datetime  :DateTimeEntry!    , ["0001-01-01 00:00:00"]
    t.bigint    :UserNum!
    t.datetime  :DateTimeFinished!
    t.bigint    :PriorityDefNum!
    t.string    :ReminderGroupId!  , 20
    t.integer   :ReminderType!     , 2
    t.integer   :ReminderFrequency!
    t.datetime  :DateTimeOriginal! , ["0001-01-01 00:00:00"]
    t.timestamp :SecDateTEdit!     , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.string    :DescriptOverride!
    t.boolean   :IsReadOnly!
    t.bigint    :TriageCategory!

    t.index     :DateTimeOriginal, name: "DateTimeOriginal"
    t.index     :KeyNum, name: "KeyNum"
    t.index     :PriorityDefNum, name: "PriorityDefNum"
    t.index     :SecDateTEdit, name: "SecDateTEdit"
    t.index     :TaskListNum, name: "indexTaskListNum"
    t.index     :TaskStatus, name: "TaskStatus"
    t.index     :TriageCategory, name: "TriageCategory"
    t.index     :UserNum, name: "UserNum"
  end

  create_table :taskancestor, primary_key: "TaskAncestorNum", id: :bigint do |t|
    t.bigint   :TaskNum!
    t.bigint   :TaskListNum!

    t.index    :TaskListNum, name: "TaskListNum"
    t.index    :TaskNum, name: "TaskNum"
  end

  create_table :taskattachment, primary_key: "TaskAttachmentNum", id: :bigint do |t|
    t.bigint   :TaskNum!
    t.bigint   :DocNum!
    t.text     :TextValue!
    t.string   :Description!

    t.index    :DocNum, name: "DocNum"
    t.index    :TaskNum, name: "TaskNum"
  end

  create_table  :taskhist, primary_key: "TaskHistNum", id: :bigint do |t|
    t.bigint    :UserNumHist!
    t.datetime  :DateTStamp!       , ["0001-01-01 00:00:00"]
    t.integer   :IsNoteChange!     , 1
    t.bigint    :TaskNum!
    t.bigint    :TaskListNum!
    t.date      :DateTask!         , ["0001-01-01"]
    t.bigint    :KeyNum!
    t.text      :Descript!
    t.integer   :TaskStatus!       , 1
    t.integer   :IsRepeating!      , 1
    t.integer   :DateType!         , 1
    t.bigint    :FromNum!
    t.integer   :ObjectType!       , 1
    t.datetime  :DateTimeEntry!    , ["0001-01-01 00:00:00"]
    t.bigint    :UserNum!
    t.datetime  :DateTimeFinished! , ["0001-01-01 00:00:00"]
    t.bigint    :PriorityDefNum!
    t.string    :ReminderGroupId!  , 20
    t.integer   :ReminderType!     , 2
    t.integer   :ReminderFrequency!
    t.datetime  :DateTimeOriginal! , ["0001-01-01 00:00:00"]
    t.timestamp :SecDateTEdit!     , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.string    :DescriptOverride!
    t.boolean   :IsReadOnly!
    t.bigint    :TriageCategory!

    t.index     :DateTStamp, name: "DateTStamp"
    t.index     :KeyNum, name: "KeyNum"
    t.index     :SecDateTEdit, name: "SecDateTEdit"
    t.index     :TaskNum, name: "TaskNum"
    t.index     :TriageCategory, name: "TriageCategory"
  end

  create_table :tasklist, primary_key: "TaskListNum", id: :bigint do |t|
    t.string   :Descript             , [""]
    t.bigint   :Parent!
    t.date     :DateTL!              , ["0001-01-01"]
    t.integer  :IsRepeating!         , 1, [0], unsigned: true
    t.integer  :DateType!            , 1, [0], unsigned: true
    t.bigint   :FromNum!
    t.integer  :ObjectType!          , 1, [0], unsigned: true
    t.datetime :DateTimeEntry!       , ["0001-01-01 00:00:00"]
    t.integer  :GlobalTaskFilterType!, 1
    t.integer  :TaskListStatus!      , 1

    t.index    :Parent, name: "indexParent"
  end

  create_table :tasknote, primary_key: "TaskNoteNum", id: :bigint do |t|
    t.bigint   :TaskNum!
    t.bigint   :UserNum!
    t.datetime :DateTimeNote!, ["0001-01-01 00:00:00"]
    t.text     :Note!

    t.index    :TaskNum, name: "TaskNum"
    t.index    :UserNum, name: "UserNum"
  end

  create_table :tasksubscription, primary_key: "TaskSubscriptionNum", id: :bigint do |t|
    t.bigint   :UserNum!
    t.bigint   :TaskListNum!
    t.bigint   :TaskNum!

    t.index    :TaskListNum, name: "TaskListNum"
    t.index    :TaskNum, name: "TaskNum"
    t.index    :UserNum, name: "UserNum"
  end

  create_table :taskunread, primary_key: "TaskUnreadNum", id: :bigint do |t|
    t.bigint   :TaskNum!
    t.bigint   :UserNum!

    t.index    :TaskNum, name: "TaskNum"
    t.index    :UserNum, name: "UserNum"
  end

  create_table :tempdupnewpatnum, id: false do |t|
    t.text     :OldPatNum!
    t.text     :NewPatNum!
  end

  create_table :tempdupoldpatnum, id: false do |t|
    t.text     :OldPatNum!
    t.text     :NewPatNum!
  end

  create_table :tempinsbluebookrule_bak_20210422, id: false do |t|
    t.bigint   :InsBlueBookRuleNum!, [0]
    t.integer  :ItemOrder!         , 2
    t.integer  :RuleType!          , 1
    t.integer  :LimitValue!
    t.integer  :LimitType!         , 1
  end

  create_table :tempmergeid, primary_key: "CurPatNum", id: :bigint, default: 0 do |t|
    t.string   :OriginalDbName, 4000, [""]
    t.bigint   :OriginalPatNum, [0]
    t.string   :ChartNumber   , [""]
    t.string   :FName         , [""]
    t.string   :LName         , [""]
    t.datetime :BirthDate     , ["0001-01-01 00:00:00"]
    t.string   :SSN           , 20, [""]
  end

  create_table :tempprogpropfix_bak, id: false do |t|
    t.bigint   :ProgramPropertyNum!, [0]
    t.bigint   :ProgramNum!
    t.string   :PropertyDesc       , [""], collation: "utf8mb3_general_ci"
    t.text     :PropertyValue      , collation: "utf8mb3_general_ci"
    t.string   :ComputerName!      , collation: "utf8mb3_general_ci"
    t.bigint   :ClinicNum!
    t.integer  :IsMasked!          , 1
    t.integer  :IsHighSecurity!    , 1
  end

  create_table :temprenumpatnum, id: false do |t|
    t.bigint   :OldPatNum!, [0]
    t.bigint   :NewPatNum!, [0]

    t.index    :OldPatNum, name: "IDX_TEMPRENUM_OLDPATNUM"
  end

  create_table :temprenumpatnum_bak, id: false do |t|
    t.text     :OldPatNum!
    t.text     :NewPatNum!
  end

  create_table :tempuserod_bak, id: false do |t|
    t.bigint   :UserNum!                   , [0]
    t.string   :UserName                   , [""]
    t.string   :Password                   , [""]
    t.bigint   :UserGroupNum!
    t.bigint   :EmployeeNum!
    t.bigint   :ClinicNum!
    t.bigint   :ProvNum!
    t.boolean  :IsHidden!
    t.bigint   :TaskListInBox!
    t.integer  :AnesthProvType!            , [3]
    t.integer  :DefaultHidePopups!         , 1
    t.integer  :PasswordIsStrong!          , 1
    t.integer  :ClinicIsRestricted!        , 1
    t.integer  :InboxHidePopups!           , 1
    t.bigint   :UserNumCEMT!
    t.datetime :DateTFail!                 , ["0001-01-01 00:00:00"]
    t.integer  :FailedAttempts!            , 1, unsigned: true
    t.string   :DomainUser!
    t.integer  :IsPasswordResetRequired!   , 1
    t.string   :MobileWebPin!
    t.integer  :MobileWebPinFailedAttempts!, 1, unsigned: true
    t.datetime :DateTLastLogin!            , ["0001-01-01 00:00:00"]
  end

  create_table :terminalactive, primary_key: "TerminalActiveNum", id: :bigint do |t|
    t.string   :ComputerName   , [""]
    t.integer  :TerminalStatus!, 1, unsigned: true
    t.bigint   :PatNum!
    t.integer  :SessionId!
    t.integer  :ProcessId!
    t.string   :SessionName!
  end

  create_table :timeadjust, primary_key: "TimeAdjustNum", id: :bigint do |t|
    t.bigint   :EmployeeNum!
    t.datetime :TimeEntry!             , ["0001-01-01 00:00:00"]
    t.time     :RegHours!              , ["2000-01-01 00:00:00"]
    t.time     :OTimeHours!            , ["2000-01-01 00:00:00"]
    t.text     :Note
    t.integer  :IsAuto!                , 1
    t.bigint   :ClinicNum!
    t.bigint   :PtoDefNum!             , [0]
    t.time     :PtoHours!              , ["2000-01-01 00:00:00"]
    t.integer  :IsUnpaidProtectedLeave!, 1, [0]
    t.bigint   :SecuUserNumEntry!      , [0]

    t.index    :ClinicNum, name: "ClinicNum"
    t.index    :EmployeeNum, name: "indexEmployeeNum"
    t.index    :PtoDefNum, name: "PtoDefNum"
    t.index    :SecuUserNumEntry, name: "SecuUserNumEntry"
  end

  create_table :timecardrule, primary_key: "TimeCardRuleNum", id: :bigint do |t|
    t.bigint   :EmployeeNum!
    t.time     :OverHoursPerDay!
    t.time     :AfterTimeOfDay!
    t.time     :BeforeTimeOfDay!
    t.integer  :IsOvertimeExempt!, 1
    t.time     :MinClockInTime!
    t.integer  :HasWeekendRate3! , 1

    t.index    :EmployeeNum, name: "EmployeeNum"
  end

  create_table :toolbutitem, primary_key: "ToolButItemNum", id: :bigint do |t|
    t.bigint   :ProgramNum!
    t.integer  :ToolBar!   , 2, [0], unsigned: true
    t.string   :ButtonText , [""]
  end

  create_table :toothgridcell, primary_key: "ToothGridCellNum", id: :bigint do |t|
    t.bigint   :SheetFieldNum!
    t.bigint   :ToothGridColNum!
    t.string   :ValueEntered!
    t.string   :ToothNum!       , 10

    t.index    :SheetFieldNum, name: "SheetFieldNum"
    t.index    :ToothGridColNum, name: "ToothGridColNum"
  end

  create_table :toothgridcol, primary_key: "ToothGridColNum", id: :bigint do |t|
    t.bigint   :SheetFieldNum!
    t.string   :NameItem!
    t.integer  :CellType!     , 1
    t.integer  :ItemOrder!    , 2
    t.integer  :ColumnWidth!  , 2
    t.bigint   :CodeNum!
    t.integer  :ProcStatus!   , 1

    t.index    :CodeNum, name: "CodeNum"
    t.index    :SheetFieldNum, name: "SheetFieldNum"
  end

  create_table :toothgriddef, primary_key: "ToothGridDefNum", id: :bigint do |t|
    t.string   :NameInternal
    t.string   :NameShowing
    t.integer  :CellType!        , 1
    t.integer  :ItemOrder!       , 2
    t.integer  :ColumnWidth!     , 2
    t.bigint   :CodeNum!
    t.integer  :ProcStatus!      , 1
    t.bigint   :SheetFieldDefNum!

    t.index    :CodeNum, name: "CodeNum"
    t.index    :SheetFieldDefNum, name: "SheetFieldDefNum"
  end

  create_table  :toothinitial, primary_key: "ToothInitialNum", id: :bigint do |t|
    t.bigint    :PatNum!
    t.string    :ToothNum      , 2, [""]
    t.integer   :InitialType!  , 1, [0], unsigned: true
    t.float     :Movement!     , [0.0]
    t.text      :DrawingSegment
    t.integer   :ColorDraw!
    t.datetime  :SecDateTEntry!, ["0001-01-01 00:00:00"]
    t.timestamp :SecDateTEdit! , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.string    :DrawText!

    t.index     :PatNum, name: "PatNum"
    t.index     :SecDateTEdit, name: "SecDateTEdit"
    t.index     :SecDateTEntry, name: "SecDateTEntry"
  end

  create_table  :transaction, primary_key: "TransactionNum", id: :bigint do |t|
    t.datetime  :DateTimeEntry!        , ["0001-01-01 00:00:00"]
    t.bigint    :UserNum!
    t.bigint    :DepositNum!
    t.bigint    :PayNum!
    t.bigint    :SecUserNumEdit!
    t.timestamp :SecDateTEdit!         , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.bigint    :TransactionInvoiceNum!

    t.index     :SecUserNumEdit, name: "SecUserNumEdit"
    t.index     :TransactionInvoiceNum, name: "TransactionInvoiceNum"
  end

  create_table :transactioninvoice, primary_key: "TransactionInvoiceNum", id: :bigint do |t|
    t.string   :FileName!
    t.text     :InvoiceData, size: :medium
    t.string   :FilePath!
  end

  create_table  :treatplan, primary_key: "TreatPlanNum", id: :bigint do |t|
    t.bigint    :PatNum!
    t.date      :DateTP!               , ["0001-01-01"]
    t.string    :Heading               , [""]
    t.text      :Note
    t.text      :Signature
    t.boolean   :SigIsTopaz!
    t.bigint    :ResponsParty!
    t.bigint    :DocNum!
    t.integer   :TPStatus!             , 1
    t.bigint    :SecUserNumEntry!
    t.date      :SecDateEntry!         , ["0001-01-01"]
    t.timestamp :SecDateTEdit!         , [-> { "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" }]
    t.bigint    :UserNumPresenter!
    t.integer   :TPType!               , 1
    t.text      :SignaturePractice!
    t.datetime  :DateTSigned!          , ["0001-01-01 00:00:00"]
    t.datetime  :DateTPracticeSigned!  , ["0001-01-01 00:00:00"]
    t.string    :SignatureText!
    t.string    :SignaturePracticeText!
    t.bigint    :MobileAppDeviceNum!

    t.index     :DocNum, name: "DocNum"
    t.index     :MobileAppDeviceNum, name: "MobileAppDeviceNum"
    t.index     :PatNum, name: "indexPatNum"
    t.index     :SecUserNumEntry, name: "SecUserNumEntry"
    t.index     :UserNumPresenter, name: "UserNumPresenter"
  end

  create_table :treatplanattach, primary_key: "TreatPlanAttachNum", id: :bigint do |t|
    t.bigint   :TreatPlanNum!
    t.bigint   :ProcNum!
    t.bigint   :Priority!

    t.index    :Priority, name: "Priority"
    t.index    :ProcNum, name: "ProcNum"
    t.index    :TreatPlanNum, name: "TreatPlanNum"
  end

  create_table :treatplanparam, primary_key: "TreatPlanParamNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.bigint   :TreatPlanNum!
    t.integer  :ShowDiscount! , 1
    t.integer  :ShowMaxDed!   , 1
    t.integer  :ShowSubTotals!, 1
    t.integer  :ShowTotals!   , 1
    t.integer  :ShowCompleted!, 1
    t.integer  :ShowFees!     , 1
    t.integer  :ShowIns!      , 1

    t.index    :PatNum, name: "PatNum"
    t.index    :TreatPlanNum, name: "TreatPlanNum"
  end

  create_table :tsitranslog, primary_key: "TsiTransLogNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.bigint   :UserNum!
    t.integer  :TransType!     , 1
    t.datetime :TransDateTime! , ["0001-01-01 00:00:00"]
    t.integer  :ServiceType!   , 1
    t.integer  :ServiceCode!   , 1
    t.float    :TransAmt!      , 53
    t.float    :AccountBalance!, 53
    t.integer  :FKeyType!      , 1
    t.bigint   :FKey!
    t.string   :RawMsgText!    , 1000
    t.string   :ClientId!      , 25
    t.text     :TransJson!     , size: :medium
    t.bigint   :ClinicNum!
    t.bigint   :AggTransLogNum!

    t.index    :AggTransLogNum, name: "AggTransLogNum"
    t.index    :ClinicNum, name: "ClinicNum"
    t.index   [:FKey, :FKeyType], name: "FKeyAndType"
    t.index    :PatNum, name: "PatNum"
    t.index    :UserNum, name: "UserNum"
  end

  create_table :ucum, primary_key: "UcumNum", id: :bigint do |t|
    t.string   :UcumCode!
    t.string   :Description!
    t.integer  :IsInUse!    , 1

    t.index    :UcumCode, name: "UcumCode"
  end

  create_table :updatehistory, primary_key: "UpdateHistoryNum", id: :bigint do |t|
    t.datetime :DateTimeUpdated!, ["0001-01-01 00:00:00"]
    t.string   :ProgramVersion!
    t.text     :Signature!
  end

  create_table :userclinic, primary_key: "UserClinicNum", id: :bigint do |t|
    t.bigint   :UserNum!
    t.bigint   :ClinicNum!

    t.index    :ClinicNum, name: "ClinicNum"
    t.index    :UserNum, name: "UserNum"
  end

  create_table :usergroup, primary_key: "UserGroupNum", id: :bigint do |t|
    t.string   :Description      , [""]
    t.bigint   :UserGroupNumCEMT!

    t.index    :UserGroupNumCEMT, name: "UserGroupNumCEMT"
  end

  create_table :usergroupattach, primary_key: "UserGroupAttachNum", id: :bigint do |t|
    t.bigint   :UserNum!
    t.bigint   :UserGroupNum!

    t.index    :UserGroupNum, name: "UserGroupNum"
    t.index    :UserNum, name: "UserNum"
  end

  create_table :userod, primary_key: "UserNum", id: :bigint do |t|
    t.string   :UserName                   , [""]
    t.string   :Password                   , [""]
    t.bigint   :UserGroupNum!
    t.bigint   :EmployeeNum!
    t.bigint   :ClinicNum!
    t.bigint   :ProvNum!
    t.boolean  :IsHidden!
    t.bigint   :TaskListInBox!
    t.integer  :AnesthProvType!            , [3]
    t.integer  :DefaultHidePopups!         , 1
    t.integer  :PasswordIsStrong!          , 1
    t.integer  :ClinicIsRestricted!        , 1
    t.integer  :InboxHidePopups!           , 1
    t.bigint   :UserNumCEMT!
    t.datetime :DateTFail!                 , ["0001-01-01 00:00:00"]
    t.integer  :FailedAttempts!            , 1, unsigned: true
    t.string   :DomainUser!
    t.integer  :IsPasswordResetRequired!   , 1
    t.string   :MobileWebPin!
    t.integer  :MobileWebPinFailedAttempts!, 1, unsigned: true
    t.datetime :DateTLastLogin!            , ["0001-01-01 00:00:00"]
    t.string   :EClipboardClinicalPin      , 128

    t.index    :ClinicNum, name: "ClinicNum"
    t.index    :ProvNum, name: "ProvNum"
    t.index    :UserGroupNum, name: "UserGroupNum"
  end

  create_table :userodapptview, primary_key: "UserodApptViewNum", id: :bigint do |t|
    t.bigint   :UserNum!
    t.bigint   :ClinicNum!
    t.bigint   :ApptViewNum!

    t.index    :ApptViewNum, name: "ApptViewNum"
    t.index    :ClinicNum, name: "ClinicNum"
    t.index    :UserNum, name: "UserNum"
  end

  create_table :userodpref, primary_key: "UserOdPrefNum", id: :bigint do |t|
    t.bigint   :UserNum!
    t.bigint   :Fkey!
    t.integer  :FkeyType!   , 1
    t.text     :ValueString!
    t.bigint   :ClinicNum!

    t.index    :ClinicNum, name: "ClinicNum"
    t.index    :Fkey, name: "Fkey"
    t.index    :UserNum, name: "UserNum"
  end

  create_table :userquery, primary_key: "QueryNum", id: :bigint do |t|
    t.string   :Description   , [""]
    t.string   :FileName      , [""]
    t.text     :QueryText!    , size: :medium
    t.integer  :IsReleased    , 1, [0]
    t.integer  :IsPromptSetup!, 1, [1]
  end

  create_table :userweb, primary_key: "UserWebNum", id: :bigint do |t|
    t.bigint   :FKey!
    t.integer  :FKeyType!             , 1
    t.string   :UserName!
    t.string   :Password!
    t.string   :PasswordResetCode!
    t.integer  :RequireUserNameChange!, 1
    t.datetime :DateTimeLastLogin!    , ["0001-01-01 00:00:00"]
    t.integer  :RequirePasswordChange!, 1

    t.index    :FKey, name: "FKey"
  end

  create_table :vaccinedef, primary_key: "VaccineDefNum", id: :bigint do |t|
    t.string   :CVXCode!
    t.string   :VaccineName!
    t.bigint   :DrugManufacturerNum!

    t.index    :DrugManufacturerNum, name: "DrugManufacturerNum"
  end

  create_table :vaccineobs, primary_key: "VaccineObsNum", id: :bigint do |t|
    t.bigint   :VaccinePatNum!
    t.integer  :ValType!           , 1
    t.integer  :IdentifyingCode!   , 1
    t.string   :ValReported!
    t.integer  :ValCodeSystem!     , 1
    t.bigint   :VaccineObsNumGroup!
    t.string   :UcumCode!
    t.date     :DateObs!           , ["0001-01-01"]
    t.string   :MethodCode!

    t.index    :VaccineObsNumGroup, name: "VaccineObsNumGroup"
    t.index    :VaccinePatNum, name: "VaccinePatNum"
  end

  create_table :vaccinepat, primary_key: "VaccinePatNum", id: :bigint do |t|
    t.bigint   :VaccineDefNum!
    t.datetime :DateTimeStart
    t.datetime :DateTimeEnd
    t.float    :AdministeredAmt!
    t.bigint   :DrugUnitNum!
    t.string   :LotNumber!
    t.bigint   :PatNum!
    t.text     :Note!
    t.string   :FilledCity!
    t.string   :FilledST!
    t.integer  :CompletionStatus!      , 1
    t.integer  :AdministrationNoteCode!, 1
    t.bigint   :UserNum!
    t.bigint   :ProvNumOrdering!
    t.bigint   :ProvNumAdminister!
    t.date     :DateExpire!            , ["0001-01-01"]
    t.integer  :RefusalReason!         , 1
    t.integer  :ActionCode!            , 1
    t.integer  :AdministrationRoute!   , 1
    t.integer  :AdministrationSite!    , 1

    t.index    :DrugUnitNum, name: "DrugUnitNum"
    t.index    :PatNum, name: "PatNum"
    t.index    :ProvNumAdminister, name: "ProvNumAdminister"
    t.index    :ProvNumOrdering, name: "ProvNumOrdering"
    t.index    :UserNum, name: "UserNum"
    t.index    :VaccineDefNum, name: "VaccineDefNum"
  end

  create_table :vitalsign, primary_key: "VitalsignNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.float    :Height!
    t.float    :Weight!
    t.integer  :BpSystolic!        , 2
    t.integer  :BpDiastolic!       , 2
    t.date     :DateTaken!         , ["0001-01-01"]
    t.integer  :HasFollowupPlan!   , 1
    t.integer  :IsIneligible!      , 1
    t.text     :Documentation!
    t.integer  :ChildGotNutrition! , 1
    t.integer  :ChildGotPhysCouns! , 1
    t.string   :WeightCode!
    t.string   :HeightExamCode!    , 30
    t.string   :WeightExamCode!    , 30
    t.string   :BMIExamCode!       , 30
    t.bigint   :EhrNotPerformedNum!
    t.bigint   :PregDiseaseNum!
    t.integer  :BMIPercentile!
    t.integer  :Pulse!

    t.index    :EhrNotPerformedNum, name: "EhrNotPerformedNum"
    t.index    :PatNum, name: "PatNum"
    t.index    :PregDiseaseNum, name: "PregDiseaseNum"
    t.index    :WeightCode, name: "WeightCode"
  end

  create_table :webschedcarrierrule, primary_key: "WebSchedCarrierRuleNum", id: :bigint do |t|
    t.bigint   :ClinicNum!
    t.string   :CarrierName!
    t.string   :DisplayName!
    t.text     :Message!
    t.integer  :Rule!       , 1

    t.index    :ClinicNum, name: "ClinicNum"
  end

  create_table :webschedrecall, primary_key: "WebSchedRecallNum", id: :bigint do |t|
    t.bigint   :ClinicNum!
    t.bigint   :PatNum!
    t.bigint   :RecallNum!
    t.datetime :DateTimeEntry!      , ["0001-01-01 00:00:00"]
    t.datetime :DateDue!            , ["0001-01-01 00:00:00"]
    t.integer  :ReminderCount!
    t.datetime :DateTimeSent!       , ["0001-01-01 00:00:00"]
    t.datetime :DateTimeSendFailed! , ["0001-01-01 00:00:00"]
    t.integer  :SendStatus!         , 1
    t.string   :ShortGUID!
    t.text     :ResponseDescript!
    t.integer  :Source!             , 1
    t.bigint   :CommlogNum!
    t.integer  :MessageType!        , 1
    t.bigint   :MessageFk!
    t.bigint   :ApptReminderRuleNum!

    t.index    :ApptReminderRuleNum, name: "ApptReminderRuleNum"
    t.index    :ClinicNum, name: "ClinicNum"
    t.index    :CommlogNum, name: "CommlogNum"
    t.index    :DateTimeEntry, name: "DateTimeEntry"
    t.index    :DateTimeSent, name: "DateTimeReminderSent"
    t.index    :MessageFk, name: "MessageFk"
    t.index    :PatNum, name: "PatNum"
    t.index    :RecallNum, name: "RecallNum"
  end

  create_table :wikilistheaderwidth, primary_key: "WikiListHeaderWidthNum", id: :bigint do |t|
    t.string   :ListName!
    t.string   :ColName!
    t.integer  :ColWidth!
    t.text     :PickList!
    t.integer  :IsHidden!, 1
  end

  create_table :wikilisthist, primary_key: "WikiListHistNum", id: :bigint do |t|
    t.bigint   :UserNum!
    t.string   :ListName!
    t.text     :ListHeaders!
    t.text     :ListContent!  , size: :medium
    t.datetime :DateTimeSaved!, ["0001-01-01 00:00:00"]

    t.index    :UserNum, name: "UserNum"
  end

  create_table :wikipage, primary_key: "WikiPageNum", id: :bigint do |t|
    t.bigint   :UserNum!
    t.string   :PageTitle!
    t.string   :KeyWords!
    t.text     :PageContent!         , size: :medium
    t.datetime :DateTimeSaved!       , ["0001-01-01 00:00:00"]
    t.integer  :IsDraft!             , 1
    t.integer  :IsLocked!            , 1
    t.integer  :IsDeleted!           , 1, [0]
    t.text     :PageContentPlainText!, size: :medium

    t.index    :UserNum, name: "UserNum"
  end

  create_table :wikipagehist, primary_key: "WikiPageNum", id: :bigint do |t|
    t.bigint   :UserNum!
    t.string   :PageTitle!
    t.text     :PageContent!  , size: :medium
    t.datetime :DateTimeSaved!, ["0001-01-01 00:00:00"]
    t.integer  :IsDeleted!    , 1

    t.index    :UserNum, name: "UserNum"
  end

  create_table :xchargetransaction, primary_key: "XChargeTransactionNum", id: :bigint do |t|
    t.string   :TransType!
    t.float    :Amount!             , 53
    t.string   :CCEntry!
    t.bigint   :PatNum!
    t.string   :Result!
    t.string   :ClerkID!
    t.string   :ResultCode!
    t.string   :Expiration!
    t.string   :CCType!
    t.string   :CreditCardNum!
    t.string   :BatchNum!
    t.string   :ItemNum!
    t.string   :ApprCode!
    t.datetime :TransactionDateTime!, ["0001-01-01 00:00:00"]
    t.float    :BatchTotal!         , 53

    t.index    :PatNum, name: "PatNum"
    t.index    :TransactionDateTime, name: "TransactionDateTime"
  end

  create_table :xwebresponse, primary_key: "XWebResponseNum", id: :bigint do |t|
    t.bigint   :PatNum!
    t.bigint   :ProvNum!
    t.bigint   :ClinicNum!
    t.bigint   :PaymentNum!
    t.datetime :DateTEntry!           , ["0001-01-01 00:00:00"]
    t.datetime :DateTUpdate!          , ["0001-01-01 00:00:00"]
    t.integer  :TransactionStatus!    , 1
    t.integer  :ResponseCode!
    t.string   :XWebResponseCode!
    t.string   :ResponseDescription!
    t.string   :OTK!
    t.text     :HpfUrl!
    t.datetime :HpfExpiration!        , ["0001-01-01 00:00:00"]
    t.string   :TransactionID!
    t.string   :TransactionType!
    t.string   :Alias!
    t.string   :CardType!
    t.string   :CardBrand!
    t.string   :CardBrandShort!
    t.string   :MaskedAcctNum!
    t.float    :Amount!               , 53
    t.string   :ApprovalCode!
    t.string   :CardCodeResponse!
    t.integer  :ReceiptID!
    t.string   :ExpDate!
    t.string   :EntryMethod!
    t.string   :ProcessorResponse!
    t.integer  :BatchNum!
    t.float    :BatchAmount!          , 53
    t.date     :AccountExpirationDate!, ["0001-01-01"]
    t.text     :DebugError!
    t.text     :PayNote!
    t.integer  :CCSource!             , 1
    t.string   :OrderId!
    t.string   :EmailResponse!
    t.string   :LogGuid               , 36

    t.index    :ClinicNum, name: "ClinicNum"
    t.index    :DateTUpdate, name: "DateTUpdate"
    t.index    :PatNum, name: "PatNum"
    t.index    :PaymentNum, name: "PaymentNum"
    t.index    :ProvNum, name: "ProvNum"
  end

  create_table :zipcode, primary_key: "ZipCodeNum", id: :bigint do |t|
    t.string   :ZipCodeDigits, 20, [""]
    t.string   :City         , 100, [""]
    t.string   :State        , 20, [""]
    t.integer  :IsFrequent!  , 1, [0], unsigned: true
  end
end
